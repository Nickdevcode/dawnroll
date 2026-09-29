-- =============================================================================
-- Dawnroll online (fase 4): amigos, convites e presença.
--
--   friendships   um par por amizade (a < b), 'pending' (pedido esperando) ou
--                 'accepted'; `requested_by` diz quem pediu.
--   blocks        quem bloqueou quem (desfaz a amizade e barra pedido/convite).
--   room_invites  "vem pra minha sala": um por par de/para, vence em 2 min.
--   presence      no menu ou jogando sozinho (+ quando o jogo avisou por
--                 último). "Numa sala" não vem daqui: sai de `room_members`
--                 (o ponto que a sala já bate), não do que o cliente diz.
--
-- Nenhuma dessas tabelas é lida direto pela API (RLS ligada, sem grant): tudo
-- passa pelas funções abaixo, que só mostram o que é seu ou de um amigo.
--
-- Aviso na hora: o banco manda o pedido/convite pro canal PRIVADO do Realtime
-- `user:<id>` (só o próprio jogador lê; ninguém escreve pela API). O canal é
-- bônus: sem ele, o jogo consulta `touch_presence` e recebe o mesmo.
--
-- Mesmo padrão das migrações anteriores: lógica no `private` (SECURITY
-- DEFINER, conferindo auth.uid()) e invólucro fino no `public`.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Tabelas
-- -----------------------------------------------------------------------------

create table public.friendships (
  user_a uuid not null references auth.users (id) on delete cascade,
  user_b uuid not null references auth.users (id) on delete cascade,
  status text not null default 'pending',
  requested_by uuid not null,
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  primary key (user_a, user_b),
  -- Par ordenado: a amizade A-B e B-A é a mesma linha (sem duplicata, sem corrida de lado).
  constraint friendships_order check (user_a < user_b),
  constraint friendships_status check (status in ('pending', 'accepted')),
  constraint friendships_requester check (requested_by in (user_a, user_b))
);
create index friendships_b on public.friendships (user_b);

create table public.blocks (
  blocker uuid not null references auth.users (id) on delete cascade,
  blocked uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker, blocked),
  constraint blocks_not_self check (blocker <> blocked)
);
create index blocks_blocked on public.blocks (blocked);

create table public.room_invites (
  id bigint generated always as identity primary key,
  from_id uuid not null references auth.users (id) on delete cascade,
  to_id uuid not null references auth.users (id) on delete cascade,
  room_id uuid not null references public.rooms (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '2 minutes',
  -- Convidar de novo troca o convite antigo (não empilha).
  constraint room_invites_pair unique (from_id, to_id),
  constraint room_invites_not_self check (from_id <> to_id)
);
create index room_invites_to on public.room_invites (to_id, expires_at);

create table public.presence (
  user_id uuid primary key references auth.users (id) on delete cascade,
  status text not null,
  updated_at timestamptz not null default now(),
  constraint presence_status check (status in ('menu', 'solo'))
);

alter table public.friendships enable row level security;
alter table public.blocks enable row level security;
alter table public.room_invites enable row level security;
alter table public.presence enable row level security;

-- O padrão do projeto dá tudo pra anon/authenticated: fecha, e não libera nada (só as funções).
revoke all on public.friendships from anon, authenticated;
revoke all on public.blocks from anon, authenticated;
revoke all on public.room_invites from anon, authenticated;
revoke all on public.presence from anon, authenticated;

-- -----------------------------------------------------------------------------
-- Canal privado de cada jogador (avisos na hora)
-- -----------------------------------------------------------------------------

-- Só leitura, só o próprio. Quem escreve é o banco (`realtime.send`, abaixo).
create policy "cada um recebe o próprio canal" on realtime.messages
  for select to authenticated
  using (realtime.messages.extension = 'broadcast' and (select realtime.topic()) = 'user:' || (select auth.uid())::text);

/**
 * Manda um aviso pro canal do jogador. Falhar aqui não desfaz o pedido nem o
 * convite: a consulta periódica do jogo entrega do mesmo jeito.
 */
create or replace function private.notify_user(p_user uuid, p_payload jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform realtime.send(p_payload, 'social', 'user:' || p_user::text, true);
exception
  when others then
    null;
end;
$$;

-- -----------------------------------------------------------------------------
-- Ajudantes
-- -----------------------------------------------------------------------------

/** O que um jogador mostra de si pros outros (o mesmo do ranking). */
create or replace function private.profile_json(p_user uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('id', p.id, 'nickname', p.nickname, 'skin', p.skin)
  from public.profiles p
  where p.id = p_user;
$$;

create or replace function private.are_friends(p_a uuid, p_b uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.friendships
    where user_a = least(p_a, p_b) and user_b = greatest(p_a, p_b) and status = 'accepted'
  );
$$;

/** Um dos dois bloqueou o outro? */
create or replace function private.blocked_between(p_a uuid, p_b uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.blocks
    where (blocker = p_a and blocked = p_b) or (blocker = p_b and blocked = p_a)
  );
$$;

/** A sala viva em que o jogador está agora (ponto recente dele e do dono), ou nada. */
create or replace function private.live_room_of(p_user uuid)
returns public.rooms
language sql
stable
security definer
set search_path = ''
as $$
  select r.*
  from public.room_members m
  join public.rooms r on r.id = m.room_id
  where m.user_id = p_user
    and m.seen_at > now() - interval '30 seconds'
    and r.heartbeat_at > now() - interval '45 seconds';
$$;

/** Está com o jogo aberto (avisou há menos de 75 s, ou está batendo o ponto numa sala)? */
create or replace function private.is_online(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.presence where user_id = p_user and updated_at > now() - interval '75 seconds')
      or exists (select 1 from public.room_members where user_id = p_user and seen_at > now() - interval '30 seconds');
$$;

/**
 * Um amigo na lista: perfil, onde está (offline / menu / solo / room) e, se
 * estiver numa sala viva, o código e a lotação (pra "Entrar" na sala dele).
 */
create or replace function private.friend_json(p_user uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  base jsonb := private.profile_json(p_user);
  room public.rooms;
  players integer;
  seen_status text;
begin
  if base is null then
    return null;
  end if;
  room := private.live_room_of(p_user);
  if room.id is not null then
    players := private.active_members(room.id);
    return base || jsonb_build_object(
      'status', 'room',
      'room', jsonb_build_object(
        'code', room.code,
        'mode', room.mode,
        'players', players,
        'max', room.max_players,
        'playing', room.status = 'playing',
        'locked', private.match_locked(room),
        'public', room.visibility = 'public'
      )
    );
  end if;
  select status into seen_status from public.presence where user_id = p_user and updated_at > now() - interval '75 seconds';
  return base || jsonb_build_object('status', coalesce(seen_status, 'offline'), 'room', null);
end;
$$;

/** Um convite como o jogo mostra: quem chamou, pra qual sala e quantos segundos ainda vale. */
create or replace function private.invite_json(p_invite bigint)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', i.id,
    'from', private.profile_json(i.from_id),
    'code', r.code,
    'mode', r.mode,
    'expiresIn', greatest(0, floor(extract(epoch from i.expires_at - now())))::integer
  )
  from public.room_invites i
  join public.rooms r on r.id = i.room_id
  where i.id = p_invite;
$$;

-- -----------------------------------------------------------------------------
-- Amizade
-- -----------------------------------------------------------------------------

/**
 * Pede amizade pelo apelido (sem diferenciar maiúscula). Devolve `status`:
 *   sent       pedido enviado (ele recebe o aviso)
 *   accepted   ele já tinha te pedido: viraram amigos na hora
 *   already    já são amigos          pending  você já pediu (esperando)
 *   not_found  não existe (ou te bloqueou: o bloqueio não se revela)
 *   self       é você                  blocked  você bloqueou (desbloqueie antes)
 *   limit      100 amigos, ou ele com pedidos demais esperando
 * e `friend` (perfil) quando achou. Limites: 60 buscas/h e 30 pedidos/dia.
 */
create or replace function private.send_friend_request(p_nickname text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := private.require_player();
  wanted text := btrim(coalesce(p_nickname, ''));
  target uuid;
  lo uuid;
  hi uuid;
  existing public.friendships;
begin
  perform private.rate_limit('friend_lookup', 60, interval '1 hour');
  if char_length(wanted) = 0 or char_length(wanted) > 40 then
    return jsonb_build_object('status', 'not_found');
  end if;
  -- Perfil escondido pela moderação não aparece em busca.
  select id into target from public.profiles where lower(nickname) = lower(wanted) and not hidden;
  if target is null or exists (select 1 from public.blocks where blocker = target and blocked = uid) then
    return jsonb_build_object('status', 'not_found');
  end if;
  if target = uid then
    return jsonb_build_object('status', 'self');
  end if;
  if exists (select 1 from public.blocks where blocker = uid and blocked = target) then
    return jsonb_build_object('status', 'blocked', 'friend', private.profile_json(target));
  end if;
  lo := least(uid, target);
  hi := greatest(uid, target);
  select * into existing from public.friendships where user_a = lo and user_b = hi for update;
  if found then
    if existing.status = 'accepted' then
      return jsonb_build_object('status', 'already', 'friend', private.profile_json(target));
    end if;
    if existing.requested_by = uid then
      return jsonb_build_object('status', 'pending', 'friend', private.profile_json(target));
    end if;
    -- Ele já tinha pedido: pedir de volta é aceitar.
    update public.friendships set status = 'accepted', accepted_at = now() where user_a = lo and user_b = hi;
    perform private.notify_user(target, jsonb_build_object('kind', 'accepted', 'from', private.profile_json(uid)));
    return jsonb_build_object('status', 'accepted', 'friend', private.profile_json(target));
  end if;
  -- Teto: 100 (amigos + pedidos seus esperando) pra você, 100 amigos e 50 pedidos esperando pra ele.
  if (select count(*) from public.friendships where (user_a = uid or user_b = uid) and (status = 'accepted' or requested_by = uid)) >= 100
     or (select count(*) from public.friendships where (user_a = target or user_b = target) and status = 'accepted') >= 100
     or (select count(*) from public.friendships where (user_a = target or user_b = target) and status = 'pending' and requested_by <> target) >= 50 then
    return jsonb_build_object('status', 'limit');
  end if;
  perform private.rate_limit('friend_request', 30, interval '1 day');
  insert into public.friendships (user_a, user_b, requested_by) values (lo, hi, uid);
  perform private.notify_user(target, jsonb_build_object('kind', 'request', 'from', private.profile_json(uid)));
  return jsonb_build_object('status', 'sent', 'friend', private.profile_json(target));
exception
  -- Os dois pediram no mesmo instante: o outro pedido já está lá (o próximo "pedir" aceita).
  when unique_violation then
    return jsonb_build_object('status', 'pending', 'friend', private.profile_json(target));
end;
$$;

/** Aceita ou recusa o pedido que `p_user` te fez. 'accepted' | 'declined' | 'not_found'. */
create or replace function private.respond_friend_request(p_user uuid, p_accept boolean)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := private.require_player();
  lo uuid := least(uid, p_user);
  hi uuid := greatest(uid, p_user);
begin
  perform 1 from public.friendships
  where user_a = lo and user_b = hi and status = 'pending' and requested_by = p_user and p_user <> uid
  for update;
  if not found then
    return 'not_found';
  end if;
  if coalesce(p_accept, false) then
    update public.friendships set status = 'accepted', accepted_at = now() where user_a = lo and user_b = hi;
    perform private.notify_user(p_user, jsonb_build_object('kind', 'accepted', 'from', private.profile_json(uid)));
    return 'accepted';
  end if;
  delete from public.friendships where user_a = lo and user_b = hi;
  return 'declined';
end;
$$;

/** Desfaz a amizade (ou cancela o pedido que você fez / recusa o que recebeu) e apaga os convites entre os dois. */
create or replace function private.remove_friend(p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := private.require_player();
begin
  delete from public.friendships where user_a = least(uid, p_user) and user_b = greatest(uid, p_user);
  delete from public.room_invites where (from_id = uid and to_id = p_user) or (from_id = p_user and to_id = uid);
end;
$$;

/** Bloqueia: desfaz a amizade, apaga convites e barra pedido/convite dele daqui pra frente. */
create or replace function private.block_user(p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := private.require_player();
begin
  if p_user is null or p_user = uid or not exists (select 1 from public.profiles where id = p_user) then
    raise exception 'invalid user' using errcode = '22023';
  end if;
  perform private.rate_limit('block', 60, interval '1 day');
  insert into public.blocks (blocker, blocked) values (uid, p_user) on conflict do nothing;
  delete from public.friendships where user_a = least(uid, p_user) and user_b = greatest(uid, p_user);
  delete from public.room_invites where (from_id = uid and to_id = p_user) or (from_id = p_user and to_id = uid);
end;
$$;

create or replace function private.unblock_user(p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.blocks where blocker = private.require_player() and blocked = p_user;
end;
$$;

/**
 * A lista inteira de uma vez: amigos (com onde estão), pedidos recebidos,
 * pedidos enviados e quem você bloqueou.
 */
create or replace function private.friends_list()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := private.require_player();
begin
  return jsonb_build_object(
    'friends', coalesce((
      select jsonb_agg(private.friend_json(case when f.user_a = uid then f.user_b else f.user_a end))
      from public.friendships f
      where (f.user_a = uid or f.user_b = uid) and f.status = 'accepted'
    ), '[]'::jsonb),
    'incoming', coalesce((
      select jsonb_agg(private.profile_json(f.requested_by) || jsonb_build_object('at', f.created_at) order by f.created_at desc)
      from public.friendships f
      where (f.user_a = uid or f.user_b = uid) and f.status = 'pending' and f.requested_by <> uid
    ), '[]'::jsonb),
    'outgoing', coalesce((
      select jsonb_agg(private.profile_json(case when f.user_a = uid then f.user_b else f.user_a end) || jsonb_build_object('at', f.created_at) order by f.created_at desc)
      from public.friendships f
      where (f.user_a = uid or f.user_b = uid) and f.status = 'pending' and f.requested_by = uid
    ), '[]'::jsonb),
    'blocked', coalesce((
      select jsonb_agg(private.profile_json(b.blocked) order by b.created_at desc)
      from public.blocks b
      where b.blocker = uid
    ), '[]'::jsonb)
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- Convites e presença
-- -----------------------------------------------------------------------------

/**
 * Chama um amigo pra sua sala. 'sent' | 'no_room' (você não está numa sala
 * viva) | 'not_friend' | 'in_room' (ele já está nela) | 'offline'. 30 por hora.
 */
create or replace function private.invite_friend(p_user uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := private.require_player();
  mine public.rooms := private.live_room_of(uid);
  theirs public.rooms;
  invite bigint;
begin
  if mine.id is null then
    return 'no_room';
  end if;
  if p_user is null or not private.are_friends(uid, p_user) or private.blocked_between(uid, p_user) then
    return 'not_friend';
  end if;
  theirs := private.live_room_of(p_user);
  if theirs.id = mine.id then
    return 'in_room';
  end if;
  if not private.is_online(p_user) then
    return 'offline';
  end if;
  perform private.rate_limit('room_invite', 30, interval '1 hour');
  -- Convite novo (id novo): o aviso aparece de novo mesmo que o anterior tenha sido dispensado.
  delete from public.room_invites where from_id = uid and to_id = p_user;
  insert into public.room_invites (from_id, to_id, room_id) values (uid, p_user, mine.id) returning id into invite;
  perform private.notify_user(p_user, jsonb_build_object('kind', 'invite', 'invite', private.invite_json(invite)));
  return 'sent';
end;
$$;

/**
 * "Estou aqui" (o jogo chama a cada 30 s e quando muda de tela): no menu ou
 * jogando sozinho. Devolve o que espera por você: quantos pedidos de amizade,
 * os convites válidos (amigo, sala viva, não vencido, você não está nela),
 * quantos amigos estão online e se você tem amigo ou pedido enviado (o jogo só
 * abre o canal de avisos quando tem alguém que possa chamar).
 */
create or replace function private.touch_presence(p_status text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := private.require_player();
begin
  if p_status is null or p_status not in ('menu', 'solo') then
    raise exception 'invalid status' using errcode = '22023';
  end if;
  insert into public.presence (user_id, status, updated_at) values (uid, p_status, now())
  on conflict (user_id) do update set status = excluded.status, updated_at = excluded.updated_at;
  return jsonb_build_object(
    'requests', (
      select count(*) from public.friendships
      where (user_a = uid or user_b = uid) and status = 'pending' and requested_by <> uid
    ),
    'friends', (
      select count(*) from public.friendships
      where (user_a = uid or user_b = uid) and (status = 'accepted' or requested_by = uid)
    ),
    'online', (
      select count(*) from public.friendships f
      where (f.user_a = uid or f.user_b = uid) and f.status = 'accepted'
        and private.is_online(case when f.user_a = uid then f.user_b else f.user_a end)
    ),
    'invites', coalesce((
      select jsonb_agg(private.invite_json(i.id) order by i.created_at desc)
      from public.room_invites i
      join public.rooms r on r.id = i.room_id
      where i.to_id = uid
        and i.expires_at > now()
        and r.heartbeat_at > now() - interval '45 seconds'
        and private.are_friends(uid, i.from_id)
        and not exists (select 1 from public.room_members m where m.user_id = uid and m.room_id = i.room_id)
    ), '[]'::jsonb)
  );
end;
$$;

/** "Agora não" (ou já entrou): o convite some. */
create or replace function private.dismiss_invite(p_invite bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.room_invites where id = p_invite and to_id = private.require_player();
end;
$$;

/** Fechou o jogo (ou saiu da conta): aparece offline na hora, sem esperar a presença vencer. */
create or replace function private.go_offline()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.presence where user_id = private.require_player();
end;
$$;

/** Faxina: convite vencido, presença de ontem e pedido parado há 60 dias. */
create or replace function private.cleanup_social()
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.room_invites where expires_at < now() - interval '5 minutes';
  delete from public.presence where updated_at < now() - interval '1 day';
  delete from public.friendships where status = 'pending' and created_at < now() - interval '60 days';
$$;

select cron.schedule('dawnroll-cleanup-social', '*/10 * * * *', 'select private.cleanup_social()');

-- -----------------------------------------------------------------------------
-- API (invólucros finos)
-- -----------------------------------------------------------------------------

create or replace function public.send_friend_request(p_nickname text)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.send_friend_request(p_nickname); $$;

create or replace function public.respond_friend_request(p_user uuid, p_accept boolean)
returns text language sql security invoker set search_path = ''
as $$ select private.respond_friend_request(p_user, p_accept); $$;

create or replace function public.remove_friend(p_user uuid)
returns void language sql security invoker set search_path = ''
as $$ select private.remove_friend(p_user); $$;

create or replace function public.block_user(p_user uuid)
returns void language sql security invoker set search_path = ''
as $$ select private.block_user(p_user); $$;

create or replace function public.unblock_user(p_user uuid)
returns void language sql security invoker set search_path = ''
as $$ select private.unblock_user(p_user); $$;

create or replace function public.friends_list()
returns jsonb language sql stable security invoker set search_path = ''
as $$ select private.friends_list(); $$;

create or replace function public.invite_friend(p_user uuid)
returns text language sql security invoker set search_path = ''
as $$ select private.invite_friend(p_user); $$;

create or replace function public.touch_presence(p_status text)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.touch_presence(p_status); $$;

create or replace function public.dismiss_invite(p_invite bigint)
returns void language sql security invoker set search_path = ''
as $$ select private.dismiss_invite(p_invite); $$;

create or replace function public.go_offline()
returns void language sql security invoker set search_path = ''
as $$ select private.go_offline(); $$;

-- Quem pode chamar o quê. O EXECUTE padrão vai pra PUBLIC: fecha tudo e libera uma a uma.
revoke execute on function private.notify_user(uuid, jsonb) from public, anon, authenticated;
revoke execute on function private.profile_json(uuid) from public, anon, authenticated;
revoke execute on function private.are_friends(uuid, uuid) from public, anon, authenticated;
revoke execute on function private.blocked_between(uuid, uuid) from public, anon, authenticated;
revoke execute on function private.live_room_of(uuid) from public, anon, authenticated;
revoke execute on function private.is_online(uuid) from public, anon, authenticated;
revoke execute on function private.friend_json(uuid) from public, anon, authenticated;
revoke execute on function private.invite_json(bigint) from public, anon, authenticated;
revoke execute on function private.cleanup_social() from public, anon, authenticated;
revoke execute on function private.send_friend_request(text) from public, anon;
revoke execute on function private.respond_friend_request(uuid, boolean) from public, anon;
revoke execute on function private.remove_friend(uuid) from public, anon;
revoke execute on function private.block_user(uuid) from public, anon;
revoke execute on function private.unblock_user(uuid) from public, anon;
revoke execute on function private.friends_list() from public, anon;
revoke execute on function private.invite_friend(uuid) from public, anon;
revoke execute on function private.touch_presence(text) from public, anon;
revoke execute on function private.dismiss_invite(bigint) from public, anon;
revoke execute on function private.go_offline() from public, anon;
revoke execute on function public.send_friend_request(text) from public, anon;
revoke execute on function public.respond_friend_request(uuid, boolean) from public, anon;
revoke execute on function public.remove_friend(uuid) from public, anon;
revoke execute on function public.block_user(uuid) from public, anon;
revoke execute on function public.unblock_user(uuid) from public, anon;
revoke execute on function public.friends_list() from public, anon;
revoke execute on function public.invite_friend(uuid) from public, anon;
revoke execute on function public.touch_presence(text) from public, anon;
revoke execute on function public.dismiss_invite(bigint) from public, anon;
revoke execute on function public.go_offline() from public, anon;

-- Os invólucros públicos são SECURITY INVOKER: quem chama precisa do EXECUTE no private também.
grant execute on function private.send_friend_request(text) to authenticated;
grant execute on function private.respond_friend_request(uuid, boolean) to authenticated;
grant execute on function private.remove_friend(uuid) to authenticated;
grant execute on function private.block_user(uuid) to authenticated;
grant execute on function private.unblock_user(uuid) to authenticated;
grant execute on function private.friends_list() to authenticated;
grant execute on function private.invite_friend(uuid) to authenticated;
grant execute on function private.touch_presence(text) to authenticated;
grant execute on function private.dismiss_invite(bigint) to authenticated;
grant execute on function private.go_offline() to authenticated;
grant execute on function public.send_friend_request(text) to authenticated;
grant execute on function public.respond_friend_request(uuid, boolean) to authenticated;
grant execute on function public.remove_friend(uuid) to authenticated;
grant execute on function public.block_user(uuid) to authenticated;
grant execute on function public.unblock_user(uuid) to authenticated;
grant execute on function public.friends_list() to authenticated;
grant execute on function public.invite_friend(uuid) to authenticated;
grant execute on function public.touch_presence(text) to authenticated;
grant execute on function public.dismiss_invite(bigint) to authenticated;
grant execute on function public.go_offline() to authenticated;
