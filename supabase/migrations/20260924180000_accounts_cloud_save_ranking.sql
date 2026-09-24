-- =============================================================================
-- Dawnroll: contas, save na nuvem e ranking global.
--
-- Três tabelas no `public` (a API do jogo) e as funções com privilégio num
-- schema `private`, que a API não enxerga:
--
--   profiles      apelido público + casco (aparece no ranking). Nasce sozinho
--                 junto com a conta (trigger em auth.users).
--   saves         o save inteiro do jogo (JSON), um por conta, com revisão pra
--                 dois aparelhos não se atropelarem.
--   player_stats  os números do ranking. O cliente NÃO escreve aqui: enterro só
--                 conta pela função `record_burials` (com limite de ritmo), e as
--                 figurinhas saem do próprio save (trigger).
--
-- Segurança: RLS em tudo, grants por coluna (o padrão do projeto dá tudo pra
-- anon/authenticated, então aqui começa revogando), funções SECURITY DEFINER só
-- no `private`, sempre conferindo auth.uid().
-- =============================================================================

create schema if not exists private;
revoke all on schema private from public;
-- As funções públicas (SECURITY INVOKER) chamam as do private: quem chama
-- precisa de USAGE no schema e EXECUTE só nas funções liberadas uma a uma
-- (o EXECUTE padrão de PUBLIC é revogado função por função abaixo e, de uma
-- vez, na migração seguinte).
grant usage on schema private to anon, authenticated;

-- -----------------------------------------------------------------------------
-- Apelido: formato e filtro de palavrão
-- -----------------------------------------------------------------------------

/** 3 a 16 caracteres: letras (com acento), números, espaço, _ . - ; sem espaço sobrando. */
create or replace function private.nickname_valid(p_nickname text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_nickname is not null
    and char_length(p_nickname) between 3 and 16
    and p_nickname = btrim(p_nickname)
    and p_nickname !~ '\s\s'
    and p_nickname ~ '^[A-Za-z0-9À-ÖØ-öø-ÿ _.-]+$'
    and p_nickname ~ '[A-Za-z0-9À-ÖØ-öø-ÿ]';
$$;

/**
 * Filtro de palavrão (pt/en). Normaliza acento e "leet" (0→o, 1→i, 4→a...)
 * antes de comparar. Palavra curta só bate inteira (senão "disputa" cairia em
 * "puta"); palavra longa e inconfundível bate em qualquer lugar, até grudada.
 * Não pega tudo — o `hidden` do perfil é a moderação de verdade.
 */
create or replace function private.nickname_clean(p_nickname text)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  normalized text;
  squashed text;
  collapsed text;
  tokens text[];
  word text;
  whole_words constant text[] := array[
    'porra', 'puta', 'puto', 'putas', 'putos', 'foda', 'fuder', 'foder', 'fodido', 'cu', 'cuzao', 'viado', 'buceta',
    'fuck', 'fucker', 'shit', 'bitch', 'cunt', 'dick', 'cock', 'pussy', 'fag', 'faggot', 'retard', 'whore', 'slut',
    'nazi', 'rape', 'rapist', 'nigga', 'nigger'
  ];
  anywhere constant text[] := array[
    'caralho', 'buceta', 'boceta', 'piroca', 'arrombad', 'fodase', 'fodasse', 'filhodaputa', 'putaria', 'punheta',
    'xoxota', 'siririca', 'estupr', 'pedofil', 'fuck', 'bitch', 'cunt', 'nigger', 'nigga', 'faggot', 'whore',
    'hitler', 'nazist'
  ];
begin
  if p_nickname is null then
    return false;
  end if;
  normalized := translate(
    lower(p_nickname),
    'áàâãäåéèêëíìîïóòôõöúùûüçñý013457@$!',
    'aaaaaaeeeeiiiiooooouuuucnyoieastasi'
  );
  squashed := regexp_replace(normalized, '[^a-z]', '', 'g');
  collapsed := regexp_replace(squashed, '(.)\1+', '\1', 'g');
  foreach word in array anywhere loop
    if position(word in squashed) > 0 or position(word in collapsed) > 0 then
      return false;
    end if;
  end loop;
  tokens := regexp_split_to_array(normalized, '[^a-z]+');
  foreach word in array tokens loop
    if word = any (whole_words) or regexp_replace(word, '(.)\1+', '\1', 'g') = any (whole_words) then
      return false;
    end if;
  end loop;
  return true;
end;
$$;

/** Apelido sorteado pra quem ainda não escolheu (conta do Google): "Dawnroller 48213". */
create or replace function private.random_nickname()
returns text
language sql
volatile
set search_path = ''
as $$
  select 'Dawnroller ' || lpad((floor(random() * 100000))::int::text, 5, '0');
$$;

grant execute on function private.nickname_valid(text) to anon, authenticated;
grant execute on function private.nickname_clean(text) to anon, authenticated;

-- -----------------------------------------------------------------------------
-- Tabelas
-- -----------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  nickname text not null,
  -- false = apelido sorteado (entrou pelo Google): o jogo pede pra escolher um.
  nickname_set boolean not null default false,
  -- Casco em uso (vem do save): o ranking desenha o besouro de cada um.
  skin text not null default 'indigo',
  -- Moderação: some do ranking e das buscas de apelido (só o dono ainda se vê).
  hidden boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_nickname_valid check (private.nickname_valid(nickname)),
  constraint profiles_skin_format check (skin ~ '^[a-z][a-zA-Z0-9]{0,31}$')
);
comment on table public.profiles is 'Perfil público do jogador: apelido e casco (ranking).';
-- Apelido único sem diferenciar maiúscula ("Bola" e "bola" são o mesmo).
create unique index profiles_nickname_key on public.profiles (lower(nickname));

create table public.saves (
  user_id uuid primary key references auth.users (id) on delete cascade,
  data jsonb not null,
  -- Sobe 1 a cada gravação; quem grava manda a revisão que leu (senão é conflito).
  revision integer not null default 1,
  updated_at timestamptz not null default now(),
  constraint saves_data_object check (jsonb_typeof(data) = 'object'),
  -- O save real tem poucos KB; o teto só barra lixo.
  constraint saves_data_size check (pg_column_size(data) <= 65536),
  constraint saves_revision_positive check (revision > 0)
);
comment on table public.saves is 'Save completo do jogo por conta (o mesmo JSON do localStorage).';

create table public.player_stats (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  buried integer not null default 0 check (buried >= 0),
  total_cm numeric(12, 1) not null default 0 check (total_cm >= 0),
  -- Segunda-feira (horário de Brasília) da semana contada em week_buried.
  week_start date,
  week_buried integer not null default 0 check (week_buried >= 0),
  stickers smallint not null default 0 check (stickers >= 0),
  -- Quando chegou no número atual de figurinhas (desempate: quem chegou antes).
  stickers_at timestamptz,
  -- Último enterro contado (desempate e limite de ritmo).
  last_burial_at timestamptz,
  -- Teto diário de enterros (dia em Brasília).
  day date,
  day_buried integer not null default 0 check (day_buried >= 0),
  -- O progresso de antes da conta (jogado como convidado) já foi trazido uma vez.
  imported boolean not null default false,
  updated_at timestamptz not null default now()
);
comment on table public.player_stats is 'Números do ranking. Escrita só pelas funções do schema private.';

alter table public.profiles enable row level security;
alter table public.saves enable row level security;
alter table public.player_stats enable row level security;

-- O padrão do projeto dá tudo pra anon/authenticated: tira e libera coluna por coluna.
revoke all on public.profiles, public.saves, public.player_stats from anon, authenticated;

grant select (id, nickname, nickname_set, skin) on public.profiles to anon, authenticated;
grant update (nickname, nickname_set, updated_at) on public.profiles to authenticated;

grant select (user_id, data, revision, updated_at) on public.saves to authenticated;
grant insert (user_id, data) on public.saves to authenticated;
grant update (data, revision, updated_at) on public.saves to authenticated;

grant select (user_id, buried, total_cm, week_start, week_buried, stickers, stickers_at, last_burial_at)
  on public.player_stats to anon, authenticated;

create policy "Perfis visíveis (menos os escondidos pela moderação)"
  on public.profiles for select
  to anon, authenticated
  using (not hidden or id = (select auth.uid()));

create policy "Cada um edita o próprio perfil"
  on public.profiles for update
  to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

create policy "Cada um lê o próprio save"
  on public.saves for select
  to authenticated
  using (user_id = (select auth.uid()));

create policy "Cada um cria o próprio save"
  on public.saves for insert
  to authenticated
  with check (user_id = (select auth.uid()));

create policy "Cada um grava o próprio save"
  on public.saves for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "Números do ranking são públicos"
  on public.player_stats for select
  to anon, authenticated
  using (true);

-- -----------------------------------------------------------------------------
-- Conta nova: perfil + linha do ranking
-- -----------------------------------------------------------------------------

/**
 * Roda quando a conta nasce (e-mail ou Google). O apelido pedido no cadastro
 * por e-mail vem em raw_user_meta_data.nickname — metadado que o próprio usuário
 * controla, então só serve de valor inicial (passa pelas mesmas regras). Sem
 * apelido válido/livre, sorteia um e marca nickname_set = false (o jogo pede).
 */
create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  wanted text := btrim(coalesce(new.raw_user_meta_data ->> 'nickname', ''));
  chosen text;
  attempts integer := 0;
begin
  if private.nickname_valid(wanted) and private.nickname_clean(wanted) then
    chosen := wanted;
  end if;
  loop
    begin
      insert into public.profiles (id, nickname, nickname_set)
      values (new.id, coalesce(chosen, private.random_nickname()), chosen is not null);
      exit;
    exception
      when unique_violation then
        -- Apelido ocupado (ou sorteio repetido): tenta de novo sorteando.
        chosen := null;
        attempts := attempts + 1;
        if attempts > 8 then
          raise;
        end if;
    end;
  end loop;
  insert into public.player_stats (user_id) values (new.id);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

-- -----------------------------------------------------------------------------
-- Save → ranking (figurinhas) e perfil (casco)
-- -----------------------------------------------------------------------------

/**
 * Figurinhas = quantas entradas do catálogo têm contagem positiva (teto de 99:
 * o jogo tem 58, então acima disso é save forjado — fácil de achar). O casco
 * vai pro perfil pro ranking desenhar o besouro certo.
 */
create or replace function private.sync_from_save()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  catalog jsonb := new.data -> 'catalog';
  sticker_count integer := 0;
  new_skin text := new.data ->> 'skin';
begin
  if jsonb_typeof(catalog) = 'object' then
    select least(count(*), 99)::integer into sticker_count
    from jsonb_each(catalog) as entry
    where entry.key ~ '^[A-Za-z0-9]{1,32}$'
      and jsonb_typeof(entry.value) = 'number'
      and (entry.value)::numeric > 0;
  end if;
  update public.player_stats
  set stickers = sticker_count,
      stickers_at = case when sticker_count > stickers then now() else stickers_at end,
      updated_at = now()
  where user_id = new.user_id
    and stickers is distinct from sticker_count;
  if new_skin ~ '^[a-z][a-zA-Z0-9]{0,31}$' then
    update public.profiles set skin = new_skin where id = new.user_id and skin is distinct from new_skin;
  end if;
  return new;
end;
$$;

create trigger on_save_written
  after insert or update of data on public.saves
  for each row execute function private.sync_from_save();

-- -----------------------------------------------------------------------------
-- Funções que o jogo chama (public = API; as com privilégio ficam no private)
-- -----------------------------------------------------------------------------

/**
 * Registra enterros no ranking. Aceita uma lista (fila de quando o jogo estava
 * sem internet). Regras, conferidas no servidor:
 *   - só bola de 3 a 30 cm (o que o jogo permite enterrar);
 *   - ritmo: desde o último enterro contado precisa ter passado 8 s por enterro
 *     da lista (a fila de quem ficou offline passa; spam não) — o primeiro
 *     envio de uma conta nova pode trazer até 10 de uma vez;
 *   - no máximo 500 por dia (Brasília) e 50 por chamada.
 * Devolve quantos contaram e os totais novos.
 */
create or replace function private.record_burials(p_diameters numeric[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  now_ts timestamptz := now();
  local_now timestamp := now() at time zone 'America/Sao_Paulo';
  this_week date := date_trunc('week', local_now)::date;
  today date := local_now::date;
  stats public.player_stats%rowtype;
  valid numeric[];
  allowed integer;
  daily_left integer;
  counted integer;
  added_cm numeric;
begin
  if uid is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'login required' using errcode = '42501';
  end if;
  if p_diameters is null or cardinality(p_diameters) = 0 then
    return jsonb_build_object('counted', 0);
  end if;
  if cardinality(p_diameters) > 50 then
    raise exception 'too many burials in one call' using errcode = '22023';
  end if;

  select array_agg(round(d, 1)) into valid
  from unnest(p_diameters) as d
  where d is not null and d >= 3 and d <= 30;

  select * into stats from public.player_stats where user_id = uid for update;
  if not found then
    raise exception 'profile missing' using errcode = 'P0002';
  end if;

  allowed := case
    when stats.last_burial_at is null then 10
    else floor(extract(epoch from (now_ts - stats.last_burial_at)) / 8)::integer
  end;
  daily_left := 500 - case when stats.day = today then stats.day_buried else 0 end;
  counted := greatest(0, least(coalesce(cardinality(valid), 0), allowed, daily_left));
  if counted = 0 then
    return jsonb_build_object('counted', 0, 'buried', stats.buried, 'week', case when stats.week_start = this_week then stats.week_buried else 0 end);
  end if;

  select coalesce(sum(d), 0) into added_cm from unnest(valid[1:counted]) as d;

  update public.player_stats
  set buried = buried + counted,
      total_cm = total_cm + added_cm,
      week_buried = case when week_start = this_week then week_buried + counted else counted end,
      week_start = this_week,
      day_buried = case when day = today then day_buried + counted else counted end,
      day = today,
      last_burial_at = now_ts,
      updated_at = now_ts
  where user_id = uid
  returning * into stats;

  return jsonb_build_object('counted', counted, 'buried', stats.buried, 'week', stats.week_buried, 'totalCm', stats.total_cm);
end;
$$;

/**
 * Traz pro ranking o que foi jogado antes de ter conta (uma vez por conta), com
 * teto: até 150 enterros e 30 cm por enterro. O save em si já vem inteiro pela
 * sincronização; isto é só a parte do ranking.
 */
create or replace function private.import_progress(p_buried integer, p_total_cm numeric)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  n integer := least(greatest(coalesce(p_buried, 0), 0), 150);
  cm numeric := round(least(greatest(coalesce(p_total_cm, 0), 0), n * 30), 1);
  stats public.player_stats%rowtype;
begin
  if uid is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'login required' using errcode = '42501';
  end if;
  update public.player_stats
  set buried = buried + n,
      total_cm = total_cm + cm,
      imported = true,
      last_burial_at = case when n > 0 then coalesce(last_burial_at, now()) else last_burial_at end,
      updated_at = now()
  where user_id = uid and not imported
  returning * into stats;
  return jsonb_build_object('imported', found, 'buried', n);
end;
$$;

/** Apaga a conta (e, em cascata, perfil, save e ranking). */
create or replace function private.delete_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'login required' using errcode = '42501';
  end if;
  delete from auth.users where id = auth.uid();
end;
$$;

revoke execute on function private.handle_new_user() from public, anon, authenticated;
revoke execute on function private.sync_from_save() from public, anon, authenticated;
revoke execute on function private.random_nickname() from public, anon, authenticated;
grant execute on function private.record_burials(numeric[]) to authenticated;
grant execute on function private.import_progress(integer, numeric) to authenticated;
grant execute on function private.delete_account() to authenticated;

/** 'ok' | 'invalid' | 'blocked' | 'taken' (o próprio apelido de quem pergunta não conta como ocupado). */
create or replace function public.check_nickname(p_nickname text)
returns text
language sql
stable
security invoker
set search_path = ''
as $$
  select case
    when not private.nickname_valid(btrim(p_nickname)) then 'invalid'
    when not private.nickname_clean(btrim(p_nickname)) then 'blocked'
    when exists (
      select 1 from public.profiles p
      where lower(p.nickname) = lower(btrim(p_nickname)) and p.id is distinct from (select auth.uid())
    ) then 'taken'
    else 'ok'
  end;
$$;

/** Troca o apelido. Devolve o mesmo status do check_nickname. */
create or replace function public.set_nickname(p_nickname text)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  wanted text := btrim(p_nickname);
  status text;
begin
  if (select auth.uid()) is null then
    raise exception 'login required' using errcode = '42501';
  end if;
  status := public.check_nickname(wanted);
  if status <> 'ok' then
    return status;
  end if;
  update public.profiles
  set nickname = wanted, nickname_set = true, updated_at = now()
  where id = (select auth.uid());
  return 'ok';
exception
  when unique_violation then
    return 'taken';
end;
$$;

/**
 * Grava o save com trava otimista: `p_base_revision` é a revisão que o
 * aparelho leu (0 = nunca teve save na nuvem). Se outro aparelho gravou no
 * meio, devolve conflict = true com o save de lá — o jogo junta os dois e tenta
 * de novo.
 */
create or replace function public.put_save(p_data jsonb, p_base_revision integer)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  current_revision integer;
  current_data jsonb;
  new_revision integer;
begin
  if uid is null then
    raise exception 'login required' using errcode = '42501';
  end if;
  if jsonb_typeof(p_data) is distinct from 'object' then
    raise exception 'save must be a JSON object' using errcode = '22023';
  end if;

  select s.revision, s.data into current_revision, current_data
  from public.saves s where s.user_id = uid
  for update;

  if not found then
    if coalesce(p_base_revision, 0) <> 0 then
      return jsonb_build_object('conflict', true, 'revision', 0, 'data', null);
    end if;
    insert into public.saves (user_id, data) values (uid, p_data)
    on conflict (user_id) do nothing
    returning revision into new_revision;
    if new_revision is null then
      select s.revision, s.data into current_revision, current_data from public.saves s where s.user_id = uid;
      return jsonb_build_object('conflict', true, 'revision', current_revision, 'data', current_data);
    end if;
    return jsonb_build_object('conflict', false, 'revision', new_revision);
  end if;

  if current_revision <> p_base_revision then
    return jsonb_build_object('conflict', true, 'revision', current_revision, 'data', current_data);
  end if;

  update public.saves
  set data = p_data, revision = current_revision + 1, updated_at = now()
  where user_id = uid;
  return jsonb_build_object('conflict', false, 'revision', current_revision + 1);
end;
$$;

/**
 * Ranking: 'buried' (enterradas), 'week' (enterradas desde segunda, Brasília),
 * 'mountain' (soma dos cm enterrados) e 'stickers' (figurinhas). Devolve o topo
 * (até 100) e, se quem pergunta estiver fora dele, a linha dele no fim.
 * Empate: quem chegou primeiro fica na frente.
 */
create or replace function public.leaderboard(p_board text, p_limit integer default 50)
returns table (rank bigint, nickname text, skin text, value numeric, is_me boolean)
language sql
stable
security invoker
set search_path = ''
as $$
  with this_week as (
    select date_trunc('week', now() at time zone 'America/Sao_Paulo')::date as start
  ),
  scored as (
    select
      s.user_id,
      p.nickname,
      p.skin,
      case p_board
        when 'buried' then s.buried::numeric
        when 'week' then case when s.week_start = (select start from this_week) then s.week_buried else 0 end::numeric
        when 'mountain' then s.total_cm
        when 'stickers' then s.stickers::numeric
      end as value,
      case when p_board = 'stickers' then s.stickers_at else s.last_burial_at end as reached_at
    from public.player_stats s
    join public.profiles p on p.id = s.user_id
    where p_board in ('buried', 'week', 'mountain', 'stickers')
  ),
  ranked as (
    select
      row_number() over (order by value desc, reached_at asc nulls last, user_id) as rank,
      nickname, skin, value, coalesce(user_id = (select auth.uid()), false) as is_me
    from scored
    where value > 0
  )
  select r.rank, r.nickname, r.skin, r.value, r.is_me
  from ranked r
  where r.rank <= least(greatest(coalesce(p_limit, 50), 1), 100) or r.is_me
  order by r.rank;
$$;

create or replace function public.record_burials(p_diameters numeric[])
returns jsonb
language sql
security invoker
set search_path = ''
as $$ select private.record_burials(p_diameters); $$;

create or replace function public.import_progress(p_buried integer, p_total_cm numeric)
returns jsonb
language sql
security invoker
set search_path = ''
as $$ select private.import_progress(p_buried, p_total_cm); $$;

create or replace function public.delete_account()
returns void
language sql
security invoker
set search_path = ''
as $$ select private.delete_account(); $$;

-- Quem pode chamar o quê (o padrão dá EXECUTE pra todo mundo).
revoke execute on function public.check_nickname(text) from public;
revoke execute on function public.set_nickname(text) from public, anon;
revoke execute on function public.put_save(jsonb, integer) from public, anon;
revoke execute on function public.leaderboard(text, integer) from public;
revoke execute on function public.record_burials(numeric[]) from public, anon;
revoke execute on function public.import_progress(integer, numeric) from public, anon;
revoke execute on function public.delete_account() from public, anon;

grant execute on function public.check_nickname(text) to anon, authenticated;
grant execute on function public.leaderboard(text, integer) to anon, authenticated;
grant execute on function public.set_nickname(text) to authenticated;
grant execute on function public.put_save(jsonb, integer) to authenticated;
grant execute on function public.record_burials(numeric[]) to authenticated;
grant execute on function public.import_progress(integer, numeric) to authenticated;
grant execute on function public.delete_account() to authenticated;

-- A função do "ligar RLS sozinho" que o Supabase cria junto com o projeto é de
-- event trigger (ninguém chama pela API), mas o EXECUTE padrão deixava o
-- advisor de segurança reclamando.
do $$
begin
  -- Só existe em projeto criado com "ligar RLS sozinho" (não num banco local zerado).
  if to_regprocedure('public.rls_auto_enable()') is not null then
    revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
  end if;
end;
$$;
