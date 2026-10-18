alter table private.profiles drop constraint if exists profiles_app_role_check;

update private.profiles
set app_role = 'administrator'
where app_role = 'operator';

alter table private.profiles
  add constraint profiles_app_role_check
  check (app_role in ('administrator', 'viewer'));

create or replace function private.is_operator()
returns boolean
language sql
stable
security definer
set search_path = private, pg_temp
as $$
  select exists (
    select 1 from private.profiles
    where user_id = auth.uid() and app_role = 'administrator'
  );
$$;

create or replace function public.op_set_profile(p_user_id uuid, p_role text)
returns void
language plpgsql
security definer
set search_path = private, public, pg_temp
as $$
begin
  perform private.assert_service();
  if p_role not in ('administrator', 'viewer') then
    raise exception 'papel invalido';
  end if;
  insert into private.profiles (user_id, app_role)
  values (p_user_id, p_role)
  on conflict (user_id) do update set app_role = excluded.app_role;
end;
$$;
