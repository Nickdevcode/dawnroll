-- =============================================================================
-- Dawnroll online (fase 3): Disputa e pareamento ("Procurar partida").
--
--   rooms.status            'open' (jardim livre, aquecendo, pódio) ou 'playing'
--                           (Disputa rolando). Quem manda é o dono da sala.
--   rooms.match_started_at  quando a Disputa atual começou: dá pra entrar no
--                           meio só nos 2 primeiros minutos.
--
--   set_room_state   o dono conta pro banco o modo e se a Disputa está rolando.
--   quick_match      te põe numa sala PÚBLICA do modo pedido (a mais cheia que
--                    ainda tem vaga e está viva) ou cria uma nova, na hora.
--   join_room        passa a recusar `match_running` (Disputa passou de 2 min).
--
-- Mesmo padrão das migrações anteriores: lógica no `private` (SECURITY
-- DEFINER, conferindo auth.uid()) e invólucro fino no `public`.
-- =============================================================================

alter table public.rooms
  add column status text not null default 'open',
  add column match_started_at timestamptz,
  add constraint rooms_status check (status in ('open', 'playing'));

grant select (status, match_started_at) on public.rooms to authenticated;

-- Busca do pareamento: só salas públicas, por modo e versão do jogo.
create index rooms_public_lookup on public.rooms (mode, protocol, heartbeat_at desc) where visibility = 'public';

/** Retrato da sala pro jogo (agora com o status). */
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
    'protocol', p_room.protocol,
    'status', p_room.status
  );
$$;

/** A Disputa desta sala já passou do tempo de entrar no meio (2 min)? */
create or replace function private.match_locked(p_room public.rooms)
returns boolean
language sql
stable
set search_path = ''
as $$
  select p_room.status = 'playing' and p_room.match_started_at is not null and p_room.match_started_at < now() - interval '2 minutes';
$$;

/** Quantos estão ativos na sala (bateram o ponto nos últimos 30 s). */
create or replace function private.active_members(p_room uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer from public.room_members where room_id = p_room and seen_at > now() - interval '30 seconds';
$$;

/** Sala nova com código sorteado; `p_host` vira o dono e o primeiro membro. */
create or replace function private.new_room(p_host uuid, p_mode text, p_visibility text, p_protocol integer)
returns public.rooms
language plpgsql
security definer
set search_path = ''
as $$
declare
  room public.rooms;
begin
  -- Colisão de código é rara (31^5 ≈ 28 mi): tenta de novo algumas vezes.
  for attempt in 1..8 loop
    insert into public.rooms (code, host_id, mode, visibility, protocol)
    values (private.new_room_code(), p_host, p_mode, p_visibility, p_protocol)
    on conflict (code) do nothing
    returning * into room;
    exit when room.id is not null;
  end loop;
  if room.id is null then
    raise exception 'could not allocate a room code' using errcode = 'P0001';
  end if;
  insert into public.room_members (room_id, user_id) values (room.id, p_host);
  return room;
end;
$$;

/** Confere modo, visibilidade e protocolo (os mesmos erros em criar e procurar). */
create or replace function private.check_room_args(p_mode text, p_visibility text, p_protocol integer)
returns void
language plpgsql
immutable
set search_path = ''
as $$
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
end;
$$;

create or replace function private.create_room(p_mode text, p_visibility text, p_protocol integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := private.require_player();
begin
  perform private.check_room_args(p_mode, p_visibility, p_protocol);
  perform private.rate_limit('room_create', 12, interval '1 hour');
  perform private.leave_current_room(uid);
  return private.room_json(private.new_room(uid, p_mode, p_visibility, p_protocol));
end;
$$;

/**
 * Entra numa sala pelo código. Erros que o jogo mostra (em `message`):
 *   room_not_found     código errado, ou sala morta (dono sem bater o ponto há 45 s)
 *   room_full          6 jogadores ativos
 *   protocol_mismatch  a página de alguém está desatualizada
 *   match_running      Disputa rolando há mais de 2 min (dá pra entrar quando acabar)
 *   rate_limited       tentativas demais (40 a cada 10 min: chutar código não compensa)
 * Já sendo da sala, só renova a vaga (voltar depois de cair a internet), mesmo no meio da Disputa.
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
  if private.active_members(room.id) >= room.max_players then
    raise exception 'room_full' using errcode = 'P0001';
  end if;
  if private.match_locked(room) then
    raise exception 'match_running' using errcode = 'P0001';
  end if;
  perform private.leave_current_room(uid);
  insert into public.room_members (room_id, user_id) values (room.id, uid);
  return private.room_json(room);
end;
$$;

/**
 * Procurar partida: sala pública do modo pedido, viva (dono bateu o ponto há
 * menos de 20 s), com vaga e que não esteja no meio de uma Disputa que já
 * passou de 2 min. Prefere a mais cheia (junta gente em vez de espalhar).
 * `skip locked`: dois procurando ao mesmo tempo não brigam pela mesma linha.
 * Sem nenhuma, cria uma pública e você é o dono (os próximos caem nela).
 * Devolve o retrato da sala com `created` (true = sala nova).
 */
create or replace function private.quick_match(p_mode text, p_protocol integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := private.require_player();
  room public.rooms;
begin
  perform private.check_room_args(p_mode, 'public', p_protocol);
  perform private.rate_limit('room_quick', 30, interval '10 minutes');
  perform private.leave_current_room(uid);
  select r.* into room
  from public.rooms r
  where r.visibility = 'public'
    and r.mode = p_mode
    and r.protocol = p_protocol
    and r.heartbeat_at > now() - interval '20 seconds'
    and not private.match_locked(r)
    and private.active_members(r.id) < r.max_players
  order by private.active_members(r.id) desc, r.created_at
  limit 1
  for update of r skip locked;
  if found then
    insert into public.room_members (room_id, user_id) values (room.id, uid);
    return private.room_json(room) || jsonb_build_object('created', false);
  end if;
  return private.room_json(private.new_room(uid, p_mode, 'public', p_protocol)) || jsonb_build_object('created', true);
end;
$$;

/**
 * O dono conta o modo e se a Disputa está rolando (o pareamento lê isso). O
 * relógio de "entrar no meio" começa quando o status vira 'playing'.
 */
create or replace function private.set_room_state(p_room uuid, p_mode text, p_status text)
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
  if p_status is null or p_status not in ('open', 'playing') then
    raise exception 'invalid status' using errcode = '22023';
  end if;
  select * into room from public.rooms where id = p_room for update;
  if not found or room.host_id <> uid then
    raise exception 'not_host' using errcode = 'P0001';
  end if;
  perform private.rate_limit('room_state', 240, interval '1 hour');
  update public.rooms
  set mode = p_mode,
      status = p_status,
      match_started_at = case
        when p_status <> 'playing' then null
        when room.status = 'playing' then coalesce(room.match_started_at, now())
        else now()
      end,
      heartbeat_at = now()
  where id = p_room
  returning * into room;
  return private.room_json(room);
end;
$$;

-- -----------------------------------------------------------------------------
-- API (invólucros finos)
-- -----------------------------------------------------------------------------

create or replace function public.quick_match(p_mode text, p_protocol integer)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.quick_match(p_mode, p_protocol); $$;

create or replace function public.set_room_state(p_room uuid, p_mode text, p_status text)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.set_room_state(p_room, p_mode, p_status); $$;

revoke execute on function private.match_locked(public.rooms) from public, anon, authenticated;
revoke execute on function private.active_members(uuid) from public, anon, authenticated;
revoke execute on function private.new_room(uuid, text, text, integer) from public, anon, authenticated;
revoke execute on function private.check_room_args(text, text, integer) from public, anon, authenticated;
revoke execute on function private.quick_match(text, integer) from public, anon;
revoke execute on function private.set_room_state(uuid, text, text) from public, anon;
revoke execute on function public.quick_match(text, integer) from public, anon;
revoke execute on function public.set_room_state(uuid, text, text) from public, anon;

grant execute on function private.quick_match(text, integer) to authenticated;
grant execute on function private.set_room_state(uuid, text, text) to authenticated;
grant execute on function public.quick_match(text, integer) to authenticated;
grant execute on function public.set_room_state(uuid, text, text) to authenticated;
