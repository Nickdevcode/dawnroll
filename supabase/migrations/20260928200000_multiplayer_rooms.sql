-- =============================================================================
-- Dawnroll online (fase 1): salas de até 6 besouros, com código de 5 letras.
--
-- O jogo em si NÃO passa por aqui: os jogadores conversam direto (WebRTC, P2P)
-- e o dono da sala repassa tudo. O banco só guarda:
--
--   rooms         a sala (código, dono, modo, versão do protocolo do jogo) e o
--                 "batimento" do dono (sala sem batimento = sala morta).
--   room_members  quem está em cada sala (um jogador numa sala por vez), com o
--                 "visto por último" de cada um (pra lotação e troca de dono).
--   net_reports   como cada conexão fechou (direta, via TURN ou falhou): é o
--                 número que diz se o plano B (servidor) vale a pena.
--
-- A sinalização do WebRTC (offer/answer) vai por um canal PRIVADO do Realtime,
-- `room:<id da sala>`, que só membro da sala consegue abrir (RLS em
-- realtime.messages, abaixo).
--
-- Mesmo padrão da primeira migração: RLS em tudo, grants por coluna, funções
-- com privilégio no `private` (SECURITY DEFINER, conferindo auth.uid()) e um
-- invólucro fino no `public`.
-- =============================================================================

-- Faxina periódica (salas mortas, vagas esquecidas, registros de ritmo velhos).
create extension if not exists pg_cron with schema pg_catalog;

-- -----------------------------------------------------------------------------
-- Ritmo: um registro por ação limitada (criar sala, tentar entrar, relatório)
-- -----------------------------------------------------------------------------

create table private.rate_events (
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null,
  at timestamptz not null default now()
);
create index rate_events_lookup on private.rate_events (user_id, kind, at desc);
revoke all on private.rate_events from public, anon, authenticated;

/** Barra a ação se o jogador já fez `p_max` dela na janela; senão, registra. */
create or replace function private.rate_limit(p_kind text, p_max integer, p_window interval)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  n integer;
begin
  select count(*) into n from private.rate_events where user_id = uid and kind = p_kind and at > now() - p_window;
  if n >= p_max then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;
  insert into private.rate_events (user_id, kind) values (uid, p_kind);
end;
$$;

/** Só conta de verdade (nem visitante sem login, nem login anônimo). */
create or replace function private.require_player()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'login required' using errcode = '42501';
  end if;
  return uid;
end;
$$;

-- -----------------------------------------------------------------------------
-- Tabelas
-- -----------------------------------------------------------------------------

create table public.rooms (
  id uuid primary key default gen_random_uuid(),
  -- 5 letras sem as que confundem (0/O, 1/I/L): dá pra ditar pro amigo do lado.
  code text not null unique,
  host_id uuid not null references auth.users (id) on delete cascade,
  mode text not null default 'garden',
  visibility text not null default 'private',
  max_players smallint not null default 6,
  -- Versão do protocolo do jogo: quem está com a página velha não entra (ver `join_room`).
  protocol smallint not null,
  created_at timestamptz not null default now(),
  heartbeat_at timestamptz not null default now(),
  constraint rooms_code_format check (code ~ '^[2-9A-HJKMNP-Z]{5}$'),
  constraint rooms_mode check (mode in ('garden', 'match')),
  constraint rooms_visibility check (visibility in ('private', 'public')),
  constraint rooms_max_players check (max_players between 2 and 6),
  constraint rooms_protocol check (protocol between 1 and 1000)
);

create table public.room_members (
  room_id uuid not null references public.rooms (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  joined_at timestamptz not null default now(),
  seen_at timestamptz not null default now(),
  primary key (room_id, user_id),
  constraint room_members_one_room unique (user_id)
);
create index room_members_room on public.room_members (room_id, joined_at);

create table public.net_reports (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users (id) on delete set null,
  route text not null,
  rtt_ms integer,
  peers smallint,
  user_agent text,
  created_at timestamptz not null default now(),
  constraint net_reports_route check (route in ('direct', 'relay', 'failed')),
  constraint net_reports_rtt check (rtt_ms is null or rtt_ms between 0 and 10000),
  constraint net_reports_peers check (peers is null or peers between 1 and 6),
  constraint net_reports_ua check (user_agent is null or char_length(user_agent) <= 200)
);

alter table public.rooms enable row level security;
alter table public.room_members enable row level security;
alter table public.net_reports enable row level security;

-- O padrão do projeto dá tudo pra anon/authenticated: começa fechando.
revoke all on public.rooms from anon, authenticated;
revoke all on public.room_members from anon, authenticated;
revoke all on public.net_reports from anon, authenticated;

-- Só leitura, só de quem é da sala; escrever é sempre pelas funções abaixo.
grant select (id, code, host_id, mode, visibility, max_players, protocol, created_at, heartbeat_at) on public.rooms to authenticated;
grant select (room_id, user_id, joined_at, seen_at) on public.room_members to authenticated;

/** O jogador é da sala? (SECURITY DEFINER: as políticas não recursam em room_members.) */
create or replace function private.is_room_member(p_room uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.room_members where room_id = p_room and user_id = (select auth.uid()));
$$;

create policy "membros veem a sala" on public.rooms
  for select to authenticated using (private.is_room_member(id));
create policy "membros veem quem está na sala" on public.room_members
  for select to authenticated using (private.is_room_member(room_id));

-- -----------------------------------------------------------------------------
-- Canal privado do Realtime (sinalização do WebRTC + presença da sala)
-- -----------------------------------------------------------------------------

/** Tópico `room:<uuid>` de uma sala da qual o jogador é membro. */
create or replace function private.can_use_room_topic(p_topic text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_topic is null or p_topic !~ '^room:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  return exists (
    select 1 from public.room_members
    where room_id = substring(p_topic from 6)::uuid and user_id = (select auth.uid())
  );
end;
$$;

create policy "membros da sala recebem" on realtime.messages
  for select to authenticated
  using (realtime.messages.extension in ('broadcast', 'presence') and private.can_use_room_topic((select realtime.topic())));

create policy "membros da sala enviam" on realtime.messages
  for insert to authenticated
  with check (realtime.messages.extension in ('broadcast', 'presence') and private.can_use_room_topic((select realtime.topic())));

-- -----------------------------------------------------------------------------
-- Salas
-- -----------------------------------------------------------------------------

/** Código novo: 5 sorteios criptográficos no alfabeto sem letra ambígua. */
create or replace function private.new_room_code()
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  alphabet constant text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  bytes bytea := extensions.gen_random_bytes(5);
  code text := '';
begin
  for i in 0..4 loop
    code := code || substr(alphabet, 1 + (get_byte(bytes, i) % 31), 1);
  end loop;
  return code;
end;
$$;

/** Retrato da sala pro jogo (o mesmo formato em criar, entrar e bater o ponto). */
create or replace function private.room_json(p_room public.rooms)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p_room.id,
    'code', p_room.code,
    'hostId', p_room.host_id,
    'mode', p_room.mode,
    'visibility', p_room.visibility,
    'maxPlayers', p_room.max_players,
    'protocol', p_room.protocol
  );
$$;

/**
 * Tira o jogador da sala em que ele estiver (se estiver). Sala vazia some; se
 * quem saiu era o dono, a vez passa pro que chegou primeiro entre os que ainda
 * estão batendo o ponto (senão, pro mais antigo de todos).
 */
create or replace function private.leave_current_room(p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  left_room uuid;
  current_host uuid;
begin
  delete from public.room_members where user_id = p_user returning room_id into left_room;
  if left_room is null then
    return;
  end if;
  select host_id into current_host from public.rooms where id = left_room for update;
  if not found then
    return;
  end if;
  if not exists (select 1 from public.room_members where room_id = left_room) then
    delete from public.rooms where id = left_room;
    return;
  end if;
  if current_host = p_user then
    update public.rooms
    set host_id = (
          select user_id from public.room_members
          where room_id = left_room
          order by (seen_at > now() - interval '15 seconds') desc, joined_at
          limit 1
        ),
        heartbeat_at = now()
    where id = left_room;
  end if;
end;
$$;

/**
 * Cria uma sala (e sai da atual, se estiver numa). Até 12 por hora.
 * Devolve o retrato da sala; quem criou é o dono.
 */
create or replace function private.create_room(p_mode text, p_visibility text, p_protocol integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := private.require_player();
  room public.rooms;
begin
  if p_mode is null or p_mode not in ('garden', 'match') then
    raise exception 'invalid mode' using errcode = '22023';
  end if;
  if p_visibility is null or p_visibility not in ('private', 'public') then
    raise exception 'invalid visibility' using errcode = '22023';
  end if;
  if p_protocol is null or p_protocol not between 1 and 1000 then
    raise exception 'invalid protocol' using errcode = '22023';
  end if;
  perform private.rate_limit('room_create', 12, interval '1 hour');
  perform private.leave_current_room(uid);
  -- Colisão de código é rara (31^5 ≈ 28 mi): tenta de novo algumas vezes.
  for attempt in 1..8 loop
    insert into public.rooms (code, host_id, mode, visibility, protocol)
    values (private.new_room_code(), uid, p_mode, p_visibility, p_protocol)
    on conflict (code) do nothing
    returning * into room;
    exit when room.id is not null;
  end loop;
  if room.id is null then
    raise exception 'could not allocate a room code' using errcode = 'P0001';
  end if;
  insert into public.room_members (room_id, user_id) values (room.id, uid);
  return private.room_json(room);
end;
$$;

/**
 * Entra numa sala pelo código. Erros que o jogo mostra (em `message`):
 *   room_not_found     código errado, ou sala morta (dono sem bater o ponto há 45 s)
 *   room_full          6 jogadores ativos
 *   protocol_mismatch  a página de alguém está desatualizada
 *   rate_limited       tentativas demais (40 a cada 10 min: chutar código não compensa)
 * Já sendo da sala, só renova a vaga (voltar depois de cair a internet).
 */
create or replace function private.join_room(p_code text, p_protocol integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := private.require_player();
  wanted text := upper(btrim(coalesce(p_code, '')));
  room public.rooms;
  active integer;
begin
  perform private.rate_limit('room_join', 40, interval '10 minutes');
  if wanted !~ '^[2-9A-HJKMNP-Z]{5}$' then
    raise exception 'room_not_found' using errcode = 'P0001';
  end if;
  select * into room from public.rooms where code = wanted for update;
  if not found or room.heartbeat_at < now() - interval '45 seconds' then
    raise exception 'room_not_found' using errcode = 'P0001';
  end if;
  if room.protocol <> p_protocol then
    raise exception 'protocol_mismatch' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.room_members where room_id = room.id and user_id = uid) then
    update public.room_members set seen_at = now() where room_id = room.id and user_id = uid;
    return private.room_json(room);
  end if;
  select count(*) into active from public.room_members
  where room_id = room.id and seen_at > now() - interval '30 seconds';
  if active >= room.max_players then
    raise exception 'room_full' using errcode = 'P0001';
  end if;
  perform private.leave_current_room(uid);
  insert into public.room_members (room_id, user_id) values (room.id, uid);
  return private.room_json(room);
end;
$$;

create or replace function private.leave_room()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.leave_current_room(private.require_player());
end;
$$;

/**
 * Bate o ponto na sala (o jogo chama a cada poucos segundos). O dono também
 * renova o batimento da sala. Devolve se a vaga ainda existe e quem é o dono
 * agora (a troca de dono pode ter acontecido por outro caminho).
 */
create or replace function private.room_heartbeat(p_room uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := private.require_player();
  host uuid;
begin
  update public.room_members set seen_at = now() where room_id = p_room and user_id = uid;
  if not found then
    return jsonb_build_object('member', false);
  end if;
  update public.rooms set heartbeat_at = now() where id = p_room and host_id = uid;
  select host_id into host from public.rooms where id = p_room;
  return jsonb_build_object('member', true, 'hostId', host);
end;
$$;

/**
 * O dono sumiu (fechou a aba, caiu a internet): um membro assume. Só vale se o
 * dono atual não é mais membro ou não bate o ponto há 6 s (ele bate a cada 2 s). Devolve o dono
 * depois da tentativa (quem perdeu a corrida segue o vencedor).
 */
create or replace function private.claim_host(p_room uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := private.require_player();
  room public.rooms;
  host_seen timestamptz;
begin
  if not exists (select 1 from public.room_members where room_id = p_room and user_id = uid) then
    raise exception 'not_member' using errcode = 'P0001';
  end if;
  -- Quem tenta assumir está ativo agora (senão o dono novo já nasceria "sumido").
  update public.room_members set seen_at = now() where room_id = p_room and user_id = uid;
  select * into room from public.rooms where id = p_room for update;
  if room.host_id = uid then
    return jsonb_build_object('hostId', uid, 'claimed', true);
  end if;
  select seen_at into host_seen from public.room_members where room_id = p_room and user_id = room.host_id;
  if host_seen is null or host_seen < now() - interval '6 seconds' then
    update public.rooms set host_id = uid, heartbeat_at = now() where id = p_room;
    return jsonb_build_object('hostId', uid, 'claimed', true);
  end if;
  return jsonb_build_object('hostId', room.host_id, 'claimed', false);
end;
$$;

/** Como a conexão fechou (até 60 por hora por jogador). */
create or replace function private.report_connection(p_route text, p_rtt_ms integer, p_peers integer, p_user_agent text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := private.require_player();
begin
  perform private.rate_limit('net_report', 60, interval '1 hour');
  insert into public.net_reports (user_id, route, rtt_ms, peers, user_agent)
  values (uid, p_route, p_rtt_ms, p_peers, left(p_user_agent, 200));
end;
$$;

/** Faxina de 5 em 5 minutos: vaga esquecida, sala morta ou vazia e registro de ritmo velho. */
create or replace function private.cleanup_rooms()
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.room_members where seen_at < now() - interval '3 minutes';
  delete from public.rooms r
  where r.heartbeat_at < now() - interval '10 minutes'
     or not exists (select 1 from public.room_members m where m.room_id = r.id);
  delete from private.rate_events where at < now() - interval '1 day';
  delete from public.net_reports where created_at < now() - interval '90 days';
$$;

select cron.schedule('dawnroll-cleanup-rooms', '*/5 * * * *', 'select private.cleanup_rooms()');

-- -----------------------------------------------------------------------------
-- API (invólucros finos)
-- -----------------------------------------------------------------------------

create or replace function public.create_room(p_mode text, p_visibility text, p_protocol integer)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.create_room(p_mode, p_visibility, p_protocol); $$;

create or replace function public.join_room(p_code text, p_protocol integer)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.join_room(p_code, p_protocol); $$;

create or replace function public.leave_room()
returns void language sql security invoker set search_path = ''
as $$ select private.leave_room(); $$;

create or replace function public.room_heartbeat(p_room uuid)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.room_heartbeat(p_room); $$;

create or replace function public.claim_host(p_room uuid)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.claim_host(p_room); $$;

create or replace function public.report_connection(p_route text, p_rtt_ms integer, p_peers integer, p_user_agent text)
returns void language sql security invoker set search_path = ''
as $$ select private.report_connection(p_route, p_rtt_ms, p_peers, p_user_agent); $$;

-- Quem pode chamar o quê. O EXECUTE padrão vai pra PUBLIC: fecha tudo e libera uma a uma.
revoke execute on function private.rate_limit(text, integer, interval) from public, anon, authenticated;
revoke execute on function private.require_player() from public, anon;
revoke execute on function private.new_room_code() from public, anon, authenticated;
revoke execute on function private.room_json(public.rooms) from public, anon, authenticated;
revoke execute on function private.leave_current_room(uuid) from public, anon, authenticated;
revoke execute on function private.cleanup_rooms() from public, anon, authenticated;
revoke execute on function private.is_room_member(uuid) from public, anon;
revoke execute on function private.can_use_room_topic(text) from public, anon;
revoke execute on function private.create_room(text, text, integer) from public, anon;
revoke execute on function private.join_room(text, integer) from public, anon;
revoke execute on function private.leave_room() from public, anon;
revoke execute on function private.room_heartbeat(uuid) from public, anon;
revoke execute on function private.claim_host(uuid) from public, anon;
revoke execute on function private.report_connection(text, integer, integer, text) from public, anon;
revoke execute on function public.create_room(text, text, integer) from public, anon;
revoke execute on function public.join_room(text, integer) from public, anon;
revoke execute on function public.leave_room() from public, anon;
revoke execute on function public.room_heartbeat(uuid) from public, anon;
revoke execute on function public.claim_host(uuid) from public, anon;
revoke execute on function public.report_connection(text, integer, integer, text) from public, anon;

-- As políticas (tabelas e Realtime) rodam como o jogador: precisam destas.
grant execute on function private.is_room_member(uuid) to authenticated;
grant execute on function private.can_use_room_topic(text) to authenticated;
-- Os invólucros públicos são SECURITY INVOKER: quem chama precisa do EXECUTE no private também.
grant execute on function private.require_player() to authenticated;
grant execute on function private.create_room(text, text, integer) to authenticated;
grant execute on function private.join_room(text, integer) to authenticated;
grant execute on function private.leave_room() to authenticated;
grant execute on function private.room_heartbeat(uuid) to authenticated;
grant execute on function private.claim_host(uuid) to authenticated;
grant execute on function private.report_connection(text, integer, integer, text) to authenticated;
grant execute on function public.create_room(text, text, integer) to authenticated;
grant execute on function public.join_room(text, integer) to authenticated;
grant execute on function public.leave_room() to authenticated;
grant execute on function public.room_heartbeat(uuid) to authenticated;
grant execute on function public.claim_host(uuid) to authenticated;
grant execute on function public.report_connection(text, integer, integer, text) to authenticated;
