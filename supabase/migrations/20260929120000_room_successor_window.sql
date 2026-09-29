-- Online: quem herda a sala quando o dono sai pelo botão.
--
-- A vaga de quem CAIU (aba morta, sem avisar) só é limpa pela faxina, minutos
-- depois. Com a janela de "ainda batendo o ponto" em 15 s, se o dono novo saísse
-- logo depois da queda, a coroa ia pro jogador morto (que chegou primeiro), e
-- os vivos esperavam 6 s pra poder assumir. Jogador vivo bate o ponto a cada
-- 5 s: 8 s de janela já separa quem está vivo de quem caiu.

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
          order by (seen_at > now() - interval '8 seconds') desc, joined_at
          limit 1
        ),
        heartbeat_at = now()
    where id = left_room;
  end if;
end;
$$;

revoke execute on function private.leave_current_room(uuid) from public, anon, authenticated;
