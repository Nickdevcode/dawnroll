-- =============================================================================
-- Dawnroll: apelido blindado (revisão de código de 24/09/2026).
--
-- O filtro de palavrão só valia pelo `set_nickname`: com o UPDATE por coluna
-- liberado em `profiles`, um PATCH direto na API (`/rest/v1/profiles`) trocava
-- o apelido pra qualquer coisa com formato válido e ia pro ranking público.
--
-- Agora: o cliente não escreve mais em `profiles` (só as funções do `private`),
-- e a própria tabela confere o filtro (defesa em profundidade).
-- =============================================================================

revoke update on public.profiles from authenticated;
drop policy if exists "Cada um edita o próprio perfil" on public.profiles;
alter table public.profiles add constraint profiles_nickname_clean check (private.nickname_clean(nickname));

/** Troca o apelido de quem chama. 'ok' | 'invalid' | 'blocked' | 'taken'. */
create or replace function private.set_nickname(p_nickname text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  wanted text := btrim(p_nickname);
begin
  if uid is null then
    raise exception 'login required' using errcode = '42501';
  end if;
  if not private.nickname_valid(wanted) then
    return 'invalid';
  end if;
  if not private.nickname_clean(wanted) then
    return 'blocked';
  end if;
  -- Aqui enxerga também os perfis escondidos pela moderação (o apelido deles continua ocupado).
  if exists (select 1 from public.profiles p where lower(p.nickname) = lower(wanted) and p.id <> uid) then
    return 'taken';
  end if;
  update public.profiles set nickname = wanted, nickname_set = true, updated_at = now() where id = uid;
  return 'ok';
exception
  when unique_violation then
    return 'taken';
end;
$$;

create or replace function public.set_nickname(p_nickname text)
returns text
language sql
security invoker
set search_path = ''
as $$ select private.set_nickname(p_nickname); $$;

-- EXECUTE que toda função nova ganha de PUBLIC (o `alter default privileges` por
-- schema não tira o padrão global): fecha tudo no private e libera uma a uma.
revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function private.nickname_valid(text) to anon, authenticated;
grant execute on function private.nickname_clean(text) to anon, authenticated;
grant execute on function private.record_burials(numeric[]) to authenticated;
grant execute on function private.import_progress(integer, numeric) to authenticated;
grant execute on function private.delete_account() to authenticated;
grant execute on function private.set_nickname(text) to authenticated;

revoke execute on function public.set_nickname(text) from public, anon;
grant execute on function public.set_nickname(text) to authenticated;
