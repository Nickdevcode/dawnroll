-- Excluir a conta sendo o dono de uma sala derrubava a sala inteira: `rooms.host_id` apaga em cascata
-- junto com o usuário, e a cascata leva a vaga de todo mundo que estava dentro (cada um via "a sala caiu").
-- Agora quem exclui a conta sai da sala antes, como no botão "Sair": sendo o dono, a sala passa pro
-- próximo (o mesmo `leave_current_room` de sempre) e quem ficou continua jogando.

/** Apaga a conta (e, em cascata, perfil, save, ranking, amigos, turma, convites). Sai da sala antes. */
create or replace function private.delete_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'login required' using errcode = '42501';
  end if;
  perform private.leave_current_room(uid);
  delete from auth.users where id = uid;
end;
$$;

revoke execute on function private.delete_account() from public, anon;
grant execute on function private.delete_account() to authenticated;
