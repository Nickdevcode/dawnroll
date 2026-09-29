-- =============================================================================
-- Dawnroll online (fase 5): turmas (clãs).
--
--   clans         a turma: nome (3 a 20) e tag (2 a 4 letras/números, maiúscula),
--                 os dois únicos e passando pelo filtro de palavrão; aberta
--                 (entra quem achar pela tag) ou fechada (só com convite); o
--                 placar da semana (bolas enterradas pelos membros).
--   clan_members  um jogador numa turma por vez; um líder por turma; a parte
--                 de cada um no placar da semana.
--   clan_invites  "vem pra minha turma" (só pra amigo), vale 7 dias.
--   clan_bans     quem o líder tirou: só volta com convite.
--
-- O placar sai de um gatilho em `player_stats`: o mesmo enterro que conta pro
-- ranking individual (com o mesmo limite de ritmo do `record_burials`) conta
-- pra turma em que a pessoa está naquela hora. Trocar de turma não leva nem
-- duplica ponto; trazer o progresso de convidado (`import_progress`) não conta.
--
-- Privacidade (tem criança jogando): colega de turma vê só se o outro está
-- online, numa sala ou offline, nunca o código da sala. O código só anda por
-- convite explícito ("Jogar com a turma" = convite de sala da fase 4).
--
-- Mesmo padrão das migrações anteriores: RLS ligada e NENHUM grant nas
-- tabelas, lógica no `private` (SECURITY DEFINER, conferindo auth.uid()) e
-- invólucro fino no `public`.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Nome e tag
-- -----------------------------------------------------------------------------

/** 3 a 20 caracteres, o mesmo alfabeto do apelido, sem espaço sobrando. */
create or replace function private.clan_name_valid(p_name text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_name is not null
    and char_length(p_name) between 3 and 20
    and p_name = btrim(p_name)
    and p_name !~ '\s\s'
    and p_name ~ '^[A-Za-z0-9À-ÖØ-öø-ÿ _.-]+$'
    and p_name ~ '[A-Za-z0-9À-ÖØ-öø-ÿ]';
$$;

/** 2 a 4 letras sem acento ou números, em maiúscula (é o que vai antes do apelido: [KHE] Nick). */
create or replace function private.clan_tag_valid(p_tag text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_tag is not null and p_tag ~ '^[A-Z0-9]{2,4}$';
$$;

/** Segunda-feira (Brasília) da semana atual: a mesma conta do `record_burials` e do ranking. */
create or replace function private.this_week()
returns date
language sql
stable
set search_path = ''
as $$
  select date_trunc('week', now() at time zone 'America/Sao_Paulo')::date;
$$;

-- -----------------------------------------------------------------------------
-- Tabelas
-- -----------------------------------------------------------------------------

create table public.clans (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  tag text not null,
  open boolean not null default true,
  -- Moderação: some do ranking, da busca e da tag dos membros (quem é da turma ainda vê).
  hidden boolean not null default false,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  -- Segunda-feira (Brasília) da semana contada em week_buried.
  week_start date,
  week_buried integer not null default 0,
  -- Quando chegou no número atual (desempate: quem chegou primeiro fica na frente).
  week_reached_at timestamptz,
  constraint clans_name_valid check (private.clan_name_valid(name)),
  constraint clans_name_clean check (private.nickname_clean(name)),
  constraint clans_tag_valid check (private.clan_tag_valid(tag)),
  constraint clans_tag_clean check (private.nickname_clean(tag)),
  constraint clans_week_buried check (week_buried >= 0)
);
create unique index clans_tag_key on public.clans (tag);
-- Nome único sem diferenciar maiúscula ("Os Rola" e "os rola" são a mesma turma).
create unique index clans_name_key on public.clans (lower(name));
create index clans_week on public.clans (week_start, week_buried desc) where not hidden;

create table public.clan_members (
  -- Chave = o jogador: uma turma por vez.
  user_id uuid primary key references auth.users (id) on delete cascade,
  clan_id uuid not null references public.clans (id) on delete cascade,
  role text not null default 'member',
  joined_at timestamptz not null default now(),
  -- A parte dele no placar da semana (só o que enterrou estando nesta turma).
  week_start date,
  week_buried integer not null default 0,
  constraint clan_members_role check (role in ('leader', 'member')),
  constraint clan_members_week_buried check (week_buried >= 0)
);
create index clan_members_clan on public.clan_members (clan_id, joined_at);
create unique index clan_members_one_leader on public.clan_members (clan_id) where role = 'leader';

create table public.clan_invites (
  id bigint generated always as identity primary key,
  clan_id uuid not null references public.clans (id) on delete cascade,
  from_id uuid not null references auth.users (id) on delete cascade,
  to_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days',
  -- Chamar de novo troca o convite antigo (não empilha).
  constraint clan_invites_pair unique (clan_id, to_id),
  constraint clan_invites_not_self check (from_id <> to_id)
);
create index clan_invites_to on public.clan_invites (to_id, expires_at);

create table public.clan_bans (
  clan_id uuid not null references public.clans (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (clan_id, user_id)
);

alter table public.clans enable row level security;
alter table public.clan_members enable row level security;
alter table public.clan_invites enable row level security;
alter table public.clan_bans enable row level security;

-- O padrão do projeto dá tudo pra anon/authenticated: fecha, e não libera nada (só as funções).
revoke all on public.clans from anon, authenticated;
revoke all on public.clan_members from anon, authenticated;
revoke all on public.clan_invites from anon, authenticated;
revoke all on public.clan_bans from anon, authenticated;

-- -----------------------------------------------------------------------------
-- Ajudantes
-- -----------------------------------------------------------------------------

/** A turma do jogador (ou nada). */
create or replace function private.clan_of(p_user uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select clan_id from public.clan_members where user_id = p_user;
$$;

/** Os dois estão na mesma turma? */
create or replace function private.same_clan(p_a uuid, p_b uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.clan_members a
    join public.clan_members b on b.clan_id = a.clan_id
    where a.user_id = p_a and b.user_id = p_b
  );
$$;

/** Posição da turma no placar da semana (nada = ainda não enterrou nesta semana, ou escondida). */
create or replace function private.clan_rank(p_clan uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select r.rank::integer
  from (
    select c.id, row_number() over (order by c.week_buried desc, c.week_reached_at asc nulls last, c.id) as rank
    from public.clans c
    where not c.hidden and c.week_start = private.this_week() and c.week_buried > 0
  ) r
  where r.id = p_clan;
$$;

/** Retrato da turma pro jogo (o mesmo na busca, no convite e na "minha turma"). */
create or replace function private.clan_card(p_clan uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', c.id,
    'tag', c.tag,
    'name', c.name,
    'open', c.open,
    'hidden', c.hidden,
    'members', (select count(*) from public.clan_members m where m.clan_id = c.id),
    'max', 20,
    'week', case when c.week_start = private.this_week() then c.week_buried else 0 end
  )
  from public.clans c
  where c.id = p_clan;
$$;

/**
 * Um colega de turma na lista: perfil, papel, a parte dele na semana e onde
 * está — offline / menu / solo / room, SEM o código da sala (ver o topo).
 */
create or replace function private.clan_member_json(p_user uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select private.profile_json(m.user_id) || jsonb_build_object(
    'role', m.role,
    'joinedAt', m.joined_at,
    'week', case when m.week_start = private.this_week() then m.week_buried else 0 end,
    'status', case
      when (private.live_room_of(m.user_id)).id is not null then 'room'
      else coalesce((select p.status from public.presence p where p.user_id = m.user_id and p.updated_at > now() - interval '75 seconds'), 'offline')
    end
  )
  from public.clan_members m
  where m.user_id = p_user;
$$;

/** Um convite pra turma como o jogo mostra: quem chamou, a turma e quantos segundos ainda vale. */
create or replace function private.clan_invite_json(p_invite bigint)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', i.id,
    'from', private.profile_json(i.from_id),
    'clan', private.clan_card(i.clan_id),
    'expiresIn', greatest(0, floor(extract(epoch from i.expires_at - now())))::integer
  )
  from public.clan_invites i
  where i.id = p_invite;
$$;

/** O que um jogador mostra de si pros outros: o mesmo do ranking + a tag da turma (a escondida não aparece). */
create or replace function private.profile_json(p_user uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('id', p.id, 'nickname', p.nickname, 'skin', p.skin, 'tag', case when c.hidden then null else c.tag end)
  from public.profiles p
  left join public.clan_members m on m.user_id = p.id
  left join public.clans c on c.id = m.clan_id
  where p.id = p_user;
$$;

/**
 * Põe o jogador na turma. Aberta: qualquer um; fechada (ou tirado pelo líder):
 * só com convite válido. 'joined' | 'closed' | 'full' (20) | 'in_clan' |
 * 'not_found'. Até 10 entradas por dia.
 */
create or replace function private.enter_clan(p_user uuid, p_clan uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  clan public.clans;
  invited boolean;
begin
  if exists (select 1 from public.clan_members where user_id = p_user) then
    return 'in_clan';
  end if;
  -- Trava a turma: duas entradas ao mesmo tempo não passam de 20.
  select * into clan from public.clans where id = p_clan and not hidden for update;
  if not found then
    return 'not_found';
  end if;
  invited := exists (select 1 from public.clan_invites where clan_id = p_clan and to_id = p_user and expires_at > now());
  if not invited and (not clan.open or exists (select 1 from public.clan_bans where clan_id = p_clan and user_id = p_user)) then
    return 'closed';
  end if;
  if (select count(*) from public.clan_members where clan_id = p_clan) >= 20 then
    return 'full';
  end if;
  perform private.rate_limit('clan_join', 10, interval '1 day');
  insert into public.clan_members (user_id, clan_id) values (p_user, p_clan);
  delete from public.clan_bans where clan_id = p_clan and user_id = p_user;
  -- Já tem turma: os outros convites não servem mais.
  delete from public.clan_invites where to_id = p_user;
  return 'joined';
exception
  -- Entrou noutra turma no mesmo instante.
  when unique_violation then
    return 'in_clan';
end;
$$;

-- -----------------------------------------------------------------------------
-- Gatilhos: placar da semana e sucessão do líder
-- -----------------------------------------------------------------------------

/**
 * O ranking individual contou enterro(s): a turma em que a pessoa está ganha
 * os mesmos. Importar o progresso de convidado (a flag `imported` vira) não conta.
 */
create or replace function private.credit_clan()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  added integer := new.buried - old.buried;
  week date := private.this_week();
  clan uuid;
begin
  if added <= 0 or new.imported is distinct from old.imported then
    return null;
  end if;
  update public.clan_members
  set week_buried = case when week_start = week then week_buried + added else added end,
      week_start = week
  where user_id = new.user_id
  returning clan_id into clan;
  if clan is null then
    return null;
  end if;
  update public.clans
  set week_buried = case when week_start = week then week_buried + added else added end,
      week_start = week,
      week_reached_at = now()
  where id = clan;
  return null;
end;
$$;

create trigger on_stats_credit_clan
  after update of buried on public.player_stats
  for each row execute function private.credit_clan();

/**
 * Alguém saiu (por conta própria, tirado, ou a conta foi apagada): se era o
 * líder, o mais antigo assume; turma vazia some (e os convites e bloqueios dela juntos).
 */
create or replace function private.clan_member_left()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.clan_members where clan_id = old.clan_id) then
    delete from public.clans where id = old.clan_id;
    return null;
  end if;
  if old.role = 'leader' and not exists (select 1 from public.clan_members where clan_id = old.clan_id and role = 'leader') then
    update public.clan_members
    set role = 'leader'
    where user_id = (select user_id from public.clan_members where clan_id = old.clan_id order by joined_at, user_id limit 1);
  end if;
  return null;
end;
$$;

create trigger on_clan_member_left
  after delete on public.clan_members
  for each row execute function private.clan_member_left();

-- -----------------------------------------------------------------------------
-- Turma: criar, achar, entrar, sair
-- -----------------------------------------------------------------------------

/**
 * Cria a turma (quem cria vira o líder). `status`: ok | invalid_name |
 * invalid_tag | blocked_name | blocked_tag (palavrão) | taken_name | taken_tag
 * | in_clan (já tem turma: sai antes). Até 3 por dia. A tag chega em qualquer
 * caixa e vira maiúscula.
 */
create or replace function private.create_clan(p_name text, p_tag text, p_open boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := private.require_player();
  wanted_name text := btrim(coalesce(p_name, ''));
  wanted_tag text := upper(btrim(coalesce(p_tag, '')));
  created uuid;
begin
  if exists (select 1 from public.clan_members where user_id = uid) then
    return jsonb_build_object('status', 'in_clan');
  end if;
  if not private.clan_name_valid(wanted_name) then
    return jsonb_build_object('status', 'invalid_name');
  end if;
  if not private.clan_tag_valid(wanted_tag) then
    return jsonb_build_object('status', 'invalid_tag');
  end if;
  if not private.nickname_clean(wanted_name) then
    return jsonb_build_object('status', 'blocked_name');
  end if;
  if not private.nickname_clean(wanted_tag) then
    return jsonb_build_object('status', 'blocked_tag');
  end if;
  -- Aqui enxerga também as escondidas pela moderação (a tag e o nome delas continuam ocupados).
  if exists (select 1 from public.clans where tag = wanted_tag) then
    return jsonb_build_object('status', 'taken_tag');
  end if;
  if exists (select 1 from public.clans where lower(name) = lower(wanted_name)) then
    return jsonb_build_object('status', 'taken_name');
  end if;
  perform private.rate_limit('clan_create', 3, interval '1 day');
  insert into public.clans (name, tag, open, created_by) values (wanted_name, wanted_tag, coalesce(p_open, true), uid)
  returning id into created;
  insert into public.clan_members (user_id, clan_id, role) values (uid, created, 'leader');
  delete from public.clan_invites where to_id = uid;
  return jsonb_build_object('status', 'ok', 'clan', private.clan_card(created));
exception
  -- Alguém pegou a tag/o nome no mesmo instante (ou você entrou noutra turma).
  when unique_violation then
    return jsonb_build_object('status',
      case
        when exists (select 1 from public.clans where tag = wanted_tag) then 'taken_tag'
        when exists (select 1 from public.clans where lower(name) = lower(wanted_name)) then 'taken_name'
        else 'in_clan'
      end);
end;
$$;

/**
 * Acha a turma pela tag (com ou sem colchete, qualquer caixa). `status` found |
 * not_found (a escondida pela moderação não aparece) e o cartão, com a posição
 * na semana, se é a sua e se você tem convite dela. 60 buscas por hora.
 */
create or replace function private.find_clan(p_tag text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := private.require_player();
  wanted text := upper(btrim(coalesce(p_tag, ''), ' []'));
  found_id uuid;
begin
  perform private.rate_limit('clan_lookup', 60, interval '1 hour');
  if not private.clan_tag_valid(wanted) then
    return jsonb_build_object('status', 'not_found');
  end if;
  select id into found_id from public.clans where tag = wanted and not hidden;
  if found_id is null then
    return jsonb_build_object('status', 'not_found');
  end if;
  return jsonb_build_object(
    'status', 'found',
    'clan', private.clan_card(found_id) || jsonb_build_object(
      'rank', private.clan_rank(found_id),
      'mine', private.clan_of(uid) is not distinct from found_id,
      'invited', exists (select 1 from public.clan_invites where clan_id = found_id and to_id = uid and expires_at > now())
    )
  );
end;
$$;

/** Entra numa turma achada pela busca (ver `enter_clan`). */
create or replace function private.join_clan(p_clan uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
begin
  return private.enter_clan(private.require_player(), p_clan);
end;
$$;

/** Sai da turma (sendo o líder, o mais antigo assume; sendo o último, a turma some). */
create or replace function private.leave_clan()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.clan_members where user_id = private.require_player();
end;
$$;

-- -----------------------------------------------------------------------------
-- Líder
-- -----------------------------------------------------------------------------

/** Tira alguém da turma (ele só volta com convite). 'ok' | 'not_leader' | 'not_member' | 'self'. */
create or replace function private.kick_clan_member(p_user uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := private.require_player();
  mine uuid;
begin
  if p_user = uid then
    return 'self';
  end if;
  select clan_id into mine from public.clan_members where user_id = uid and role = 'leader';
  if mine is null then
    return 'not_leader';
  end if;
  delete from public.clan_members where user_id = p_user and clan_id = mine;
  if not found then
    return 'not_member';
  end if;
  insert into public.clan_bans (clan_id, user_id) values (mine, p_user) on conflict do nothing;
  delete from public.clan_invites where clan_id = mine and to_id = p_user;
  return 'ok';
end;
$$;

/** Passa a liderança pra outro membro. 'ok' | 'not_leader' | 'not_member'. */
create or replace function private.promote_clan_member(p_user uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := private.require_player();
  mine uuid;
begin
  select clan_id into mine from public.clan_members where user_id = uid and role = 'leader' for update;
  if mine is null then
    return 'not_leader';
  end if;
  if p_user = uid then
    return 'ok';
  end if;
  perform 1 from public.clan_members where user_id = p_user and clan_id = mine for update;
  if not found then
    return 'not_member';
  end if;
  -- Nessa ordem: nunca existem dois líderes (índice único).
  update public.clan_members set role = 'member' where user_id = uid;
  update public.clan_members set role = 'leader' where user_id = p_user;
  return 'ok';
end;
$$;

/** Abre (qualquer um entra pela tag) ou fecha (só com convite). 'ok' | 'not_leader'. */
create or replace function private.set_clan_open(p_open boolean)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := private.require_player();
begin
  update public.clans set open = coalesce(p_open, true)
  where id = (select clan_id from public.clan_members where user_id = uid and role = 'leader');
  return case when found then 'ok' else 'not_leader' end;
end;
$$;

-- -----------------------------------------------------------------------------
-- Convites pra turma
-- -----------------------------------------------------------------------------

/**
 * Chama um amigo pra sua turma (qualquer membro chama; a amizade é o
 * consentimento). 'sent' | 'no_clan' | 'not_friend' | 'member' (já é da sua) |
 * 'in_clan' (já tem outra) | 'full'. 30 por hora.
 */
create or replace function private.invite_to_clan(p_user uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := private.require_player();
  mine uuid := private.clan_of(uid);
  theirs uuid;
  invite bigint;
begin
  if mine is null then
    return 'no_clan';
  end if;
  if p_user is null or not private.are_friends(uid, p_user) or private.blocked_between(uid, p_user) then
    return 'not_friend';
  end if;
  theirs := private.clan_of(p_user);
  if theirs = mine then
    return 'member';
  end if;
  if theirs is not null then
    return 'in_clan';
  end if;
  if (select count(*) from public.clan_members where clan_id = mine) >= 20 then
    return 'full';
  end if;
  perform private.rate_limit('clan_invite', 30, interval '1 hour');
  -- Convite novo (id novo): o aviso aparece de novo mesmo que o anterior tenha sido recusado.
  delete from public.clan_invites where clan_id = mine and to_id = p_user;
  insert into public.clan_invites (clan_id, from_id, to_id) values (mine, uid, p_user) returning id into invite;
  perform private.notify_user(p_user, jsonb_build_object('kind', 'clan_invite', 'invite', private.clan_invite_json(invite)));
  return 'sent';
end;
$$;

/** Aceita (entra, mesmo fechada) ou recusa. 'joined' | 'declined' | 'not_found' | e os de `enter_clan`. */
create or replace function private.respond_clan_invite(p_invite bigint, p_accept boolean)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := private.require_player();
  invite public.clan_invites;
begin
  select * into invite from public.clan_invites where id = p_invite and to_id = uid and expires_at > now();
  if not found then
    return 'not_found';
  end if;
  if not coalesce(p_accept, false) then
    delete from public.clan_invites where id = p_invite;
    return 'declined';
  end if;
  return private.enter_clan(uid, invite.clan_id);
end;
$$;

-- -----------------------------------------------------------------------------
-- A tela da turma e o "Jogar com a turma"
-- -----------------------------------------------------------------------------

/**
 * Tudo da tela Turma de uma vez: a turma (cartão + posição na semana), o seu
 * papel, os membros (do mais antigo pro mais novo) e, sem turma, os convites
 * que chegaram.
 */
create or replace function private.my_clan()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := private.require_player();
  mine uuid := private.clan_of(uid);
begin
  if mine is null then
    return jsonb_build_object(
      'clan', null,
      'role', null,
      'members', '[]'::jsonb,
      'invites', coalesce((
        select jsonb_agg(private.clan_invite_json(i.id) order by i.created_at desc)
        from public.clan_invites i
        join public.clans c on c.id = i.clan_id
        where i.to_id = uid and i.expires_at > now() and not c.hidden and not private.blocked_between(uid, i.from_id)
      ), '[]'::jsonb)
    );
  end if;
  return jsonb_build_object(
    'clan', private.clan_card(mine) || jsonb_build_object('rank', private.clan_rank(mine)),
    'role', (select role from public.clan_members where user_id = uid),
    'members', coalesce((
      select jsonb_agg(private.clan_member_json(m.user_id) order by m.joined_at, m.user_id)
      from public.clan_members m
      where m.clan_id = mine
    ), '[]'::jsonb),
    'invites', '[]'::jsonb
  );
end;
$$;

/**
 * Chama pra sua sala todo mundo da turma que está com o jogo aberto e fora
 * dela (convite de sala da fase 4, com o aviso na hora). `status` sent |
 * none (ninguém online fora da sala) | no_room | no_clan, e `count`. 10 por hora.
 */
create or replace function private.call_clan()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := private.require_player();
  mine uuid := private.clan_of(uid);
  room public.rooms := private.live_room_of(uid);
  targets uuid[];
  target uuid;
  invite bigint;
begin
  if mine is null then
    return jsonb_build_object('status', 'no_clan', 'count', 0);
  end if;
  if room.id is null then
    return jsonb_build_object('status', 'no_room', 'count', 0);
  end if;
  select coalesce(array_agg(m.user_id), '{}') into targets
  from public.clan_members m
  where m.clan_id = mine
    and m.user_id <> uid
    and private.is_online(m.user_id)
    and not private.blocked_between(uid, m.user_id)
    and not exists (select 1 from public.room_members rm where rm.user_id = m.user_id and rm.room_id = room.id);
  if cardinality(targets) = 0 then
    return jsonb_build_object('status', 'none', 'count', 0);
  end if;
  perform private.rate_limit('clan_call', 10, interval '1 hour');
  foreach target in array targets loop
    delete from public.room_invites where from_id = uid and to_id = target;
    insert into public.room_invites (from_id, to_id, room_id) values (uid, target, room.id) returning id into invite;
    perform private.notify_user(target, jsonb_build_object('kind', 'invite', 'invite', private.invite_json(invite)));
  end loop;
  return jsonb_build_object('status', 'sent', 'count', cardinality(targets));
end;
$$;

/**
 * Ranking das turmas na semana (desde segunda 0h, Brasília): o topo (até 100)
 * e, se a turma de quem pergunta estiver fora dele, a linha dela no fim.
 * Público, como o ranking dos jogadores. Empate: quem chegou primeiro.
 */
create or replace function private.clan_leaderboard(p_limit integer)
returns table (rank bigint, tag text, name text, members integer, value integer, is_mine boolean)
language sql
stable
security definer
set search_path = ''
as $$
  with ranked as (
    select c.id, c.tag, c.name, c.week_buried as value,
      row_number() over (order by c.week_buried desc, c.week_reached_at asc nulls last, c.id) as rank
    from public.clans c
    where not c.hidden and c.week_start = private.this_week() and c.week_buried > 0
  ),
  mine as (
    select private.clan_of((select auth.uid())) as id
  )
  select r.rank, r.tag, r.name,
    (select count(*)::integer from public.clan_members m where m.clan_id = r.id),
    r.value,
    coalesce(r.id = (select id from mine), false)
  from ranked r
  where r.rank <= least(greatest(coalesce(p_limit, 50), 1), 100) or r.id = (select id from mine)
  order by r.rank;
$$;

-- -----------------------------------------------------------------------------
-- Presença (fase 4) com a turma: convite de sala de colega de turma vale, e o
-- jogo fica sabendo dos convites de turma e se tem turma (abre o canal de avisos)
-- -----------------------------------------------------------------------------

create or replace function private.touch_presence(p_status text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := private.require_player();
  in_clan boolean;
begin
  if p_status is null or p_status not in ('menu', 'solo') then
    raise exception 'invalid status' using errcode = '22023';
  end if;
  insert into public.presence (user_id, status, updated_at) values (uid, p_status, now())
  on conflict (user_id) do update set status = excluded.status, updated_at = excluded.updated_at;
  in_clan := exists (select 1 from public.clan_members where user_id = uid);
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
    'clan', in_clan,
    'clanInvites', case when in_clan then 0 else (
      select count(*) from public.clan_invites i
      join public.clans c on c.id = i.clan_id
      where i.to_id = uid and i.expires_at > now() and not c.hidden and not private.blocked_between(uid, i.from_id)
    ) end,
    'invites', coalesce((
      select jsonb_agg(private.invite_json(i.id) order by i.created_at desc)
      from public.room_invites i
      join public.rooms r on r.id = i.room_id
      where i.to_id = uid
        and i.expires_at > now()
        and r.heartbeat_at > now() - interval '45 seconds'
        and (private.are_friends(uid, i.from_id) or private.same_clan(uid, i.from_id))
        and not private.blocked_between(uid, i.from_id)
        and not exists (select 1 from public.room_members m where m.user_id = uid and m.room_id = i.room_id)
    ), '[]'::jsonb)
  );
end;
$$;

/** Faxina (a cada 10 min, o mesmo trabalho da fase 4): + convite de turma vencido. */
create or replace function private.cleanup_social()
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.room_invites where expires_at < now() - interval '5 minutes';
  delete from public.presence where updated_at < now() - interval '1 day';
  delete from public.friendships where status = 'pending' and created_at < now() - interval '60 days';
  delete from public.clan_invites where expires_at < now();
$$;

-- -----------------------------------------------------------------------------
-- API (invólucros finos)
-- -----------------------------------------------------------------------------

create or replace function public.create_clan(p_name text, p_tag text, p_open boolean)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.create_clan(p_name, p_tag, p_open); $$;

create or replace function public.find_clan(p_tag text)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.find_clan(p_tag); $$;

create or replace function public.join_clan(p_clan uuid)
returns text language sql security invoker set search_path = ''
as $$ select private.join_clan(p_clan); $$;

create or replace function public.leave_clan()
returns void language sql security invoker set search_path = ''
as $$ select private.leave_clan(); $$;

create or replace function public.kick_clan_member(p_user uuid)
returns text language sql security invoker set search_path = ''
as $$ select private.kick_clan_member(p_user); $$;

create or replace function public.promote_clan_member(p_user uuid)
returns text language sql security invoker set search_path = ''
as $$ select private.promote_clan_member(p_user); $$;

create or replace function public.set_clan_open(p_open boolean)
returns text language sql security invoker set search_path = ''
as $$ select private.set_clan_open(p_open); $$;

create or replace function public.invite_to_clan(p_user uuid)
returns text language sql security invoker set search_path = ''
as $$ select private.invite_to_clan(p_user); $$;

create or replace function public.respond_clan_invite(p_invite bigint, p_accept boolean)
returns text language sql security invoker set search_path = ''
as $$ select private.respond_clan_invite(p_invite, p_accept); $$;

create or replace function public.my_clan()
returns jsonb language sql stable security invoker set search_path = ''
as $$ select private.my_clan(); $$;

create or replace function public.call_clan()
returns jsonb language sql security invoker set search_path = ''
as $$ select private.call_clan(); $$;

create or replace function public.clan_leaderboard(p_limit integer default 50)
returns table (rank bigint, tag text, name text, members integer, value integer, is_mine boolean)
language sql stable security invoker set search_path = ''
as $$ select * from private.clan_leaderboard(p_limit); $$;

-- Quem pode chamar o quê. O EXECUTE padrão vai pra PUBLIC: fecha tudo e libera uma a uma.
revoke execute on function private.clan_name_valid(text) from public, anon, authenticated;
revoke execute on function private.clan_tag_valid(text) from public, anon, authenticated;
revoke execute on function private.this_week() from public, anon, authenticated;
revoke execute on function private.clan_of(uuid) from public, anon, authenticated;
revoke execute on function private.same_clan(uuid, uuid) from public, anon, authenticated;
revoke execute on function private.clan_rank(uuid) from public, anon, authenticated;
revoke execute on function private.clan_card(uuid) from public, anon, authenticated;
revoke execute on function private.clan_member_json(uuid) from public, anon, authenticated;
revoke execute on function private.clan_invite_json(bigint) from public, anon, authenticated;
revoke execute on function private.enter_clan(uuid, uuid) from public, anon, authenticated;
revoke execute on function private.credit_clan() from public, anon, authenticated;
revoke execute on function private.clan_member_left() from public, anon, authenticated;
revoke execute on function private.create_clan(text, text, boolean) from public, anon;
revoke execute on function private.find_clan(text) from public, anon;
revoke execute on function private.join_clan(uuid) from public, anon;
revoke execute on function private.leave_clan() from public, anon;
revoke execute on function private.kick_clan_member(uuid) from public, anon;
revoke execute on function private.promote_clan_member(uuid) from public, anon;
revoke execute on function private.set_clan_open(boolean) from public, anon;
revoke execute on function private.invite_to_clan(uuid) from public, anon;
revoke execute on function private.respond_clan_invite(bigint, boolean) from public, anon;
revoke execute on function private.my_clan() from public, anon;
revoke execute on function private.call_clan() from public, anon;
revoke execute on function private.clan_leaderboard(integer) from public;
revoke execute on function public.create_clan(text, text, boolean) from public, anon;
revoke execute on function public.find_clan(text) from public, anon;
revoke execute on function public.join_clan(uuid) from public, anon;
revoke execute on function public.leave_clan() from public, anon;
revoke execute on function public.kick_clan_member(uuid) from public, anon;
revoke execute on function public.promote_clan_member(uuid) from public, anon;
revoke execute on function public.set_clan_open(boolean) from public, anon;
revoke execute on function public.invite_to_clan(uuid) from public, anon;
revoke execute on function public.respond_clan_invite(bigint, boolean) from public, anon;
revoke execute on function public.my_clan() from public, anon;
revoke execute on function public.call_clan() from public, anon;
revoke execute on function public.clan_leaderboard(integer) from public;

-- Os invólucros públicos são SECURITY INVOKER: quem chama precisa do EXECUTE no private também.
grant execute on function private.create_clan(text, text, boolean) to authenticated;
grant execute on function private.find_clan(text) to authenticated;
grant execute on function private.join_clan(uuid) to authenticated;
grant execute on function private.leave_clan() to authenticated;
grant execute on function private.kick_clan_member(uuid) to authenticated;
grant execute on function private.promote_clan_member(uuid) to authenticated;
grant execute on function private.set_clan_open(boolean) to authenticated;
grant execute on function private.invite_to_clan(uuid) to authenticated;
grant execute on function private.respond_clan_invite(bigint, boolean) to authenticated;
grant execute on function private.my_clan() to authenticated;
grant execute on function private.call_clan() to authenticated;
grant execute on function private.clan_leaderboard(integer) to anon, authenticated;
grant execute on function public.create_clan(text, text, boolean) to authenticated;
grant execute on function public.find_clan(text) to authenticated;
grant execute on function public.join_clan(uuid) to authenticated;
grant execute on function public.leave_clan() to authenticated;
grant execute on function public.kick_clan_member(uuid) to authenticated;
grant execute on function public.promote_clan_member(uuid) to authenticated;
grant execute on function public.set_clan_open(boolean) to authenticated;
grant execute on function public.invite_to_clan(uuid) to authenticated;
grant execute on function public.respond_clan_invite(bigint, boolean) to authenticated;
grant execute on function public.my_clan() to authenticated;
grant execute on function public.call_clan() to authenticated;
grant execute on function public.clan_leaderboard(integer) to anon, authenticated;
