-- Centralizador: tabelas em private, views em public, chaves no Vault.
-- O Data API só expõe public. Escrita passa por funções security definer
-- concedidas apenas à service_role.

create extension if not exists supabase_vault with schema vault;
create extension if not exists pgcrypto;

create schema if not exists private;

revoke all on schema private from public, anon;
grant usage on schema private to authenticated, service_role;

-- Papéis -----------------------------------------------------------------

create table private.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  app_role text not null check (app_role in ('administrator', 'viewer')),
  created_at timestamptz not null default now()
);

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

create or replace function private.is_viewer()
returns boolean
language sql
stable
security definer
set search_path = private, pg_temp
as $$
  select exists (
    select 1 from private.profiles
    where user_id = auth.uid() and app_role = 'viewer'
  );
$$;

revoke all on function private.is_operator() from public, anon;
revoke all on function private.is_viewer() from public, anon;
grant execute on function private.is_operator() to authenticated, service_role;
grant execute on function private.is_viewer() to authenticated, service_role;

create or replace function private.assert_service()
returns void
language plpgsql
stable
security definer
set search_path = private, pg_temp
as $$
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' then
    raise exception 'forbidden';
  end if;
end;
$$;

revoke all on function private.assert_service() from public, anon, authenticated;

-- Tabelas ----------------------------------------------------------------

create table private.github_connections (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  github_login text not null,
  vault_secret_id uuid not null,
  paused boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table private.repositories (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references private.github_connections (id) on delete cascade,
  github_repo_id bigint not null unique,
  owner text not null,
  name text not null,
  full_name text not null,
  is_private boolean not null,
  default_branch text not null,
  description text,
  homepage text,
  html_url text,
  clone_url text,
  visibility text not null default 'interno' check (visibility in ('interno', 'vitrine')),
  showcase_title text,
  showcase_summary text,
  highlight text,
  highlight_public boolean not null default false,
  internal_note text,
  project_type text check (project_type in (
    'produto', 'experimento', 'biblioteca', 'site', 'ferramenta', 'pesquisa', 'automacao', 'estudo'
  )),
  code_kind text check (code_kind in (
    'aplicacao', 'biblioteca', 'script', 'infraestrutura', 'dados', 'documentacao', 'misto'
  )),
  topics text[] not null default '{}',
  sync_mode text not null default 'reconcile_only' check (sync_mode in ('webhook', 'reconcile_only')),
  webhook_vault_secret_id uuid,
  github_hook_id bigint,
  last_synced_sha text,
  pending_tip_sha text,
  history_limit int not null default 100 check (history_limit > 0 and history_limit <= 500),
  history_since timestamptz not null default (now() - interval '90 days'),
  backfill_page int not null default 1 check (backfill_page > 0),
  incremental_page int not null default 1 check (incremental_page > 0),
  backfill_done boolean not null default false,
  sync_status text not null default 'idle' check (sync_status in ('idle', 'running', 'error', 'paused')),
  sync_error text,
  paused boolean not null default false,
  last_remote_check_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table private.repository_languages (
  repository_id uuid not null references private.repositories (id) on delete cascade,
  language text not null,
  bytes bigint not null check (bytes >= 0),
  primary key (repository_id, language)
);

create table private.features (
  id uuid primary key default gen_random_uuid(),
  repository_id uuid not null references private.repositories (id) on delete cascade,
  name text not null,
  description text,
  show_in_showcase boolean not null default true,
  position int not null default 0,
  created_at timestamptz not null default now()
);

create table private.commits (
  id uuid primary key default gen_random_uuid(),
  repository_id uuid not null references private.repositories (id) on delete cascade,
  sha text not null,
  message text not null,
  showcase_message text,
  author_name text,
  author_login text,
  committed_at timestamptz not null,
  additions int,
  deletions int,
  files_changed int,
  files_truncated boolean not null default false,
  unique (repository_id, sha)
);

create table private.commit_files (
  id uuid primary key default gen_random_uuid(),
  commit_id uuid not null references private.commits (id) on delete cascade,
  filename text not null,
  status text not null check (status in ('added', 'modified', 'removed', 'renamed')),
  additions int,
  deletions int
);

create table private.sync_runs (
  id uuid primary key default gen_random_uuid(),
  trigger text not null check (trigger in ('webhook', 'reconcile', 'manual')),
  repository_id uuid references private.repositories (id) on delete cascade,
  status text not null check (status in ('running', 'ok', 'error')),
  pending boolean,
  repos_remaining int,
  commits_added int,
  error text,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create unique index sync_runs_single_running
  on private.sync_runs ((true))
  where status = 'running';

create table private.secret_uses (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references private.github_connections (id) on delete cascade,
  action text not null check (action in ('decrypt_for_sync', 'decrypt_for_webhook', 'rotate')),
  occurred_at timestamptz not null default now()
);

create or replace function private.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger github_connections_touch
  before update on private.github_connections
  for each row execute function private.touch_updated_at();

create trigger repositories_touch
  before update on private.repositories
  for each row execute function private.touch_updated_at();

-- RLS --------------------------------------------------------------------

alter table private.profiles enable row level security;
alter table private.github_connections enable row level security;
alter table private.repositories enable row level security;
alter table private.repository_languages enable row level security;
alter table private.features enable row level security;
alter table private.commits enable row level security;
alter table private.commit_files enable row level security;
alter table private.sync_runs enable row level security;
alter table private.secret_uses enable row level security;

alter table private.profiles force row level security;
alter table private.github_connections force row level security;
alter table private.repositories force row level security;
alter table private.repository_languages force row level security;
alter table private.features force row level security;
alter table private.commits force row level security;
alter table private.commit_files force row level security;
alter table private.sync_runs force row level security;
alter table private.secret_uses force row level security;

create policy profiles_own on private.profiles
  for select to authenticated
  using (user_id = auth.uid());

create policy connections_operator on private.github_connections
  for select to authenticated
  using (private.is_operator());

create policy repositories_operator on private.repositories
  for select to authenticated
  using (private.is_operator());

create policy repositories_viewer on private.repositories
  for select to authenticated
  using (private.is_viewer() and visibility = 'vitrine');

create policy languages_operator on private.repository_languages
  for select to authenticated
  using (private.is_operator());

create policy languages_viewer on private.repository_languages
  for select to authenticated
  using (
    private.is_viewer()
    and exists (
      select 1 from private.repositories r
      where r.id = repository_id and r.visibility = 'vitrine'
    )
  );

create policy features_operator on private.features
  for select to authenticated
  using (private.is_operator());

create policy features_viewer on private.features
  for select to authenticated
  using (
    private.is_viewer()
    and show_in_showcase
    and exists (
      select 1 from private.repositories r
      where r.id = repository_id and r.visibility = 'vitrine'
    )
  );

create policy commits_operator on private.commits
  for select to authenticated
  using (private.is_operator());

create policy commits_viewer on private.commits
  for select to authenticated
  using (
    private.is_viewer()
    and showcase_message is not null
    and exists (
      select 1 from private.repositories r
      where r.id = repository_id and r.visibility = 'vitrine'
    )
  );

create policy files_operator on private.commit_files
  for select to authenticated
  using (private.is_operator());

create policy runs_operator on private.sync_runs
  for select to authenticated
  using (private.is_operator());

create policy uses_operator on private.secret_uses
  for select to authenticated
  using (private.is_operator());

grant select on private.profiles to authenticated;
grant select on private.github_connections to authenticated;
grant select on private.repositories to authenticated;
grant select on private.repository_languages to authenticated;
grant select on private.features to authenticated;
grant select on private.commits to authenticated;
grant select on private.commit_files to authenticated;
grant select on private.sync_runs to authenticated;
grant select on private.secret_uses to authenticated;

-- Views ------------------------------------------------------------------

create view public.my_profile
with (security_invoker = true) as
select user_id, app_role
from private.profiles
where user_id = auth.uid();

create view public.panel_connections
with (security_invoker = true) as
select id, label, github_login, paused, created_at
from private.github_connections
where private.is_operator();

create view public.panel_repositories
with (security_invoker = true) as
select
  id, connection_id, github_repo_id, owner, name, full_name, is_private, default_branch,
  description, homepage, html_url, clone_url, visibility, showcase_title, showcase_summary,
  highlight, highlight_public, internal_note, project_type, code_kind, topics, sync_mode,
  last_synced_sha, history_limit, history_since, backfill_page, backfill_done, sync_status,
  sync_error, paused, last_remote_check_at, created_at, updated_at,
  (
    select count(*) from private.features f where f.repository_id = private.repositories.id
  ) as feature_count
from private.repositories
where private.is_operator();

create view public.panel_languages
with (security_invoker = true) as
select
  repository_id,
  language,
  bytes,
  round(
    100.0 * bytes / nullif(sum(bytes) over (partition by repository_id), 0),
    1
  ) as percent
from private.repository_languages
where private.is_operator();

create view public.panel_features
with (security_invoker = true) as
select id, repository_id, name, description, show_in_showcase, position, created_at
from private.features
where private.is_operator();

create view public.panel_commits
with (security_invoker = true) as
select
  c.id, c.repository_id, c.sha, c.message, c.showcase_message, c.author_name, c.author_login,
  c.committed_at, c.additions, c.deletions, c.files_changed, c.files_truncated,
  r.full_name, r.project_type, r.code_kind, r.visibility, r.paused, r.showcase_title
from private.commits c
join private.repositories r on r.id = c.repository_id
where private.is_operator();

create view public.panel_commit_files
with (security_invoker = true) as
select f.id, f.commit_id, f.filename, f.status, f.additions, f.deletions, c.repository_id
from private.commit_files f
join private.commits c on c.id = f.commit_id
where private.is_operator();

create view public.panel_sync_runs
with (security_invoker = true) as
select id, trigger, repository_id, status, pending, repos_remaining, commits_added, error, started_at, finished_at
from private.sync_runs
where private.is_operator();

create view public.panel_secret_uses
with (security_invoker = true) as
select id, connection_id, action, occurred_at
from private.secret_uses
where private.is_operator();

create view public.showcase_repositories
with (security_invoker = true) as
select
  id,
  coalesce(nullif(showcase_title, ''), 'Projeto') as showcase_title,
  showcase_summary,
  project_type,
  code_kind,
  case when highlight_public then highlight else null end as highlight,
  (
    select count(*) from private.features f
    where f.repository_id = private.repositories.id and f.show_in_showcase
  ) as feature_count
from private.repositories
where private.is_viewer() and visibility = 'vitrine';

create view public.showcase_commits
with (security_invoker = true) as
select c.id, c.repository_id, c.showcase_message, c.committed_at, c.additions, c.deletions, c.files_changed
from private.commits c
join private.repositories r on r.id = c.repository_id
where private.is_viewer()
  and r.visibility = 'vitrine'
  and c.showcase_message is not null;

create view public.showcase_languages
with (security_invoker = true) as
select
  l.repository_id,
  l.language,
  round(
    100.0 * l.bytes / nullif(sum(l.bytes) over (partition by l.repository_id), 0),
    1
  ) as percent
from private.repository_languages l
join private.repositories r on r.id = l.repository_id
where private.is_viewer() and r.visibility = 'vitrine';

create view public.showcase_features
with (security_invoker = true) as
select f.id, f.repository_id, f.name, f.description, f.position
from private.features f
join private.repositories r on r.id = f.repository_id
where private.is_viewer() and r.visibility = 'vitrine' and f.show_in_showcase;

grant select on public.my_profile to authenticated;
grant select on public.panel_connections to authenticated;
grant select on public.panel_repositories to authenticated;
grant select on public.panel_languages to authenticated;
grant select on public.panel_features to authenticated;
grant select on public.panel_commits to authenticated;
grant select on public.panel_commit_files to authenticated;
grant select on public.panel_sync_runs to authenticated;
grant select on public.panel_secret_uses to authenticated;
grant select on public.showcase_repositories to authenticated;
grant select on public.showcase_commits to authenticated;
grant select on public.showcase_languages to authenticated;
grant select on public.showcase_features to authenticated;

revoke all on public.my_profile from anon;
revoke all on public.panel_connections from anon;
revoke all on public.panel_repositories from anon;
revoke all on public.panel_languages from anon;
revoke all on public.panel_features from anon;
revoke all on public.panel_commits from anon;
revoke all on public.panel_commit_files from anon;
revoke all on public.panel_sync_runs from anon;
revoke all on public.panel_secret_uses from anon;
revoke all on public.showcase_repositories from anon;
revoke all on public.showcase_commits from anon;
revoke all on public.showcase_languages from anon;
revoke all on public.showcase_features from anon;

-- Operações da service role ----------------------------------------------

create or replace function public.op_store_connection(p_label text, p_login text, p_token text)
returns uuid
language plpgsql
security definer
set search_path = private, vault, public, pg_temp
as $$
declare
  v_id uuid := gen_random_uuid();
  v_secret uuid;
begin
  perform private.assert_service();
  if p_label is null or length(trim(p_label)) = 0 then
    raise exception 'rotulo obrigatorio';
  end if;
  if p_token is null or length(p_token) < 10 then
    raise exception 'token invalido';
  end if;
  v_secret := vault.create_secret(p_token, 'gh-conn-' || v_id::text, 'github token');
  insert into private.github_connections (id, label, github_login, vault_secret_id)
  values (v_id, trim(p_label), p_login, v_secret);
  return v_id;
end;
$$;

create or replace function public.op_delete_connection(p_id uuid)
returns void
language plpgsql
security definer
set search_path = private, vault, public, pg_temp
as $$
declare
  v_secret uuid;
  v_hook uuid;
begin
  perform private.assert_service();
  select vault_secret_id into v_secret from private.github_connections where id = p_id;
  for v_hook in
    select webhook_vault_secret_id from private.repositories
    where connection_id = p_id and webhook_vault_secret_id is not null
  loop
    delete from vault.secrets where id = v_hook;
  end loop;
  delete from private.github_connections where id = p_id;
  if v_secret is not null then
    delete from vault.secrets where id = v_secret;
  end if;
end;
$$;

create or replace function public.op_token(p_connection_id uuid)
returns text
language plpgsql
security definer
set search_path = private, vault, public, pg_temp
as $$
declare
  v_secret uuid;
  v_token text;
begin
  perform private.assert_service();
  select vault_secret_id into v_secret from private.github_connections where id = p_connection_id;
  if v_secret is null then
    raise exception 'conexao ausente';
  end if;
  select decrypted_secret into v_token from vault.decrypted_secrets where id = v_secret;
  insert into private.secret_uses (connection_id, action)
  values (p_connection_id, 'decrypt_for_sync');
  return v_token;
end;
$$;

create or replace function public.op_webhook_secret(p_repository_id uuid)
returns text
language plpgsql
security definer
set search_path = private, vault, public, pg_temp
as $$
declare
  v_secret uuid;
  v_connection uuid;
  v_token text;
begin
  perform private.assert_service();
  select webhook_vault_secret_id, connection_id into v_secret, v_connection
  from private.repositories where id = p_repository_id;
  if v_secret is null then
    raise exception 'webhook ausente';
  end if;
  select decrypted_secret into v_token from vault.decrypted_secrets where id = v_secret;
  insert into private.secret_uses (connection_id, action)
  values (v_connection, 'decrypt_for_webhook');
  return v_token;
end;
$$;

create or replace function public.op_store_webhook(p_repository_id uuid, p_secret text, p_hook_id bigint)
returns void
language plpgsql
security definer
set search_path = private, vault, public, pg_temp
as $$
declare
  v_old uuid;
  v_new uuid;
  v_connection uuid;
begin
  perform private.assert_service();
  select webhook_vault_secret_id, connection_id into v_old, v_connection
  from private.repositories where id = p_repository_id;
  v_new := vault.create_secret(p_secret, 'gh-hook-' || p_repository_id::text, 'webhook secret');
  update private.repositories
  set webhook_vault_secret_id = v_new,
      github_hook_id = p_hook_id,
      sync_mode = 'webhook'
  where id = p_repository_id;
  insert into private.secret_uses (connection_id, action) values (v_connection, 'rotate');
  if v_old is not null then
    delete from vault.secrets where id = v_old;
  end if;
end;
$$;

create or replace function public.op_save_repository(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = private, public, pg_temp
as $$
declare
  v_id uuid;
begin
  perform private.assert_service();
  insert into private.repositories (
    connection_id, github_repo_id, owner, name, full_name, is_private, default_branch,
    description, homepage, html_url, clone_url, topics, showcase_title
  ) values (
    (p ->> 'connection_id')::uuid,
    (p ->> 'github_repo_id')::bigint,
    p ->> 'owner',
    p ->> 'name',
    p ->> 'full_name',
    (p ->> 'is_private')::boolean,
    p ->> 'default_branch',
    p ->> 'description',
    p ->> 'homepage',
    p ->> 'html_url',
    p ->> 'clone_url',
    coalesce(array(select jsonb_array_elements_text(p -> 'topics')), '{}'),
    coalesce(nullif(p ->> 'description', ''), p ->> 'name')
  )
  on conflict (github_repo_id) do update set
    description = excluded.description,
    homepage = excluded.homepage,
    html_url = excluded.html_url,
    clone_url = excluded.clone_url,
    default_branch = excluded.default_branch,
    is_private = excluded.is_private,
    topics = excluded.topics
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.op_patch_repository(p_id uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path = private, public, pg_temp
as $$
begin
  perform private.assert_service();
  update private.repositories set
    paused = coalesce((p ->> 'paused')::boolean, paused),
    visibility = coalesce(p ->> 'visibility', visibility),
    showcase_title = case when p ? 'showcase_title' then p ->> 'showcase_title' else showcase_title end,
    showcase_summary = case when p ? 'showcase_summary' then p ->> 'showcase_summary' else showcase_summary end,
    highlight = case when p ? 'highlight' then p ->> 'highlight' else highlight end,
    highlight_public = coalesce((p ->> 'highlight_public')::boolean, highlight_public),
    internal_note = case when p ? 'internal_note' then p ->> 'internal_note' else internal_note end,
    project_type = case when p ? 'project_type' then nullif(p ->> 'project_type', '') else project_type end,
    code_kind = case when p ? 'code_kind' then nullif(p ->> 'code_kind', '') else code_kind end,
    history_limit = coalesce((p ->> 'history_limit')::int, history_limit),
    sync_mode = coalesce(p ->> 'sync_mode', sync_mode),
    sync_status = coalesce(p ->> 'sync_status', sync_status),
    sync_error = case when p ? 'sync_error' then p ->> 'sync_error' else sync_error end,
    last_synced_sha = case when p ? 'last_synced_sha' then p ->> 'last_synced_sha' else last_synced_sha end,
    pending_tip_sha = case when p ? 'pending_tip_sha' then p ->> 'pending_tip_sha' else pending_tip_sha end,
    backfill_page = coalesce((p ->> 'backfill_page')::int, backfill_page),
    incremental_page = coalesce((p ->> 'incremental_page')::int, incremental_page),
    backfill_done = coalesce((p ->> 'backfill_done')::boolean, backfill_done),
    last_remote_check_at = case
      when p ? 'last_remote_check_at' then nullif(p ->> 'last_remote_check_at', '')::timestamptz
      else last_remote_check_at
    end
  where id = p_id;
end;
$$;

create or replace function public.op_save_languages(p_repository_id uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path = private, public, pg_temp
as $$
declare
  v_item jsonb;
begin
  perform private.assert_service();
  delete from private.repository_languages where repository_id = p_repository_id;
  for v_item in select jsonb_array_elements(p)
  loop
    insert into private.repository_languages (repository_id, language, bytes)
    values (p_repository_id, v_item ->> 'language', (v_item ->> 'bytes')::bigint);
  end loop;
end;
$$;

create or replace function public.op_save_commits(p_repository_id uuid, p jsonb)
returns int
language plpgsql
security definer
set search_path = private, public, pg_temp
as $$
declare
  v_item jsonb;
  v_file jsonb;
  v_commit uuid;
  v_existed boolean;
  v_added int := 0;
  v_count int;
  v_index int;
  v_status text;
begin
  perform private.assert_service();
  for v_item in select jsonb_array_elements(p)
  loop
    select id into v_commit from private.commits
    where repository_id = p_repository_id and sha = v_item ->> 'sha';
    v_existed := v_commit is not null;
    if v_existed then
      update private.commits set
        additions = coalesce(additions, (v_item ->> 'additions')::int),
        deletions = coalesce(deletions, (v_item ->> 'deletions')::int),
        files_changed = coalesce(files_changed, (v_item ->> 'files_changed')::int),
        files_truncated = files_truncated or coalesce((v_item ->> 'files_truncated')::boolean, false)
      where id = v_commit;
    else
      insert into private.commits (
        repository_id, sha, message, author_name, author_login, committed_at,
        additions, deletions, files_changed, files_truncated
      ) values (
        p_repository_id,
        v_item ->> 'sha',
        coalesce(v_item ->> 'message', ''),
        v_item ->> 'author_name',
        v_item ->> 'author_login',
        (v_item ->> 'committed_at')::timestamptz,
        (v_item ->> 'additions')::int,
        (v_item ->> 'deletions')::int,
        (v_item ->> 'files_changed')::int,
        coalesce((v_item ->> 'files_truncated')::boolean, false)
      ) returning id into v_commit;
      v_added := v_added + 1;
    end if;

    if v_item ? 'files' and jsonb_array_length(v_item -> 'files') > 0 then
      if not exists (select 1 from private.commit_files where commit_id = v_commit) then
        v_index := 0;
        for v_file in select jsonb_array_elements(v_item -> 'files')
        loop
          v_index := v_index + 1;
          exit when v_index > 100;
          v_status := v_file ->> 'status';
          if v_status not in ('added', 'modified', 'removed', 'renamed') then
            v_status := 'modified';
          end if;
          insert into private.commit_files (commit_id, filename, status, additions, deletions)
          values (
            v_commit,
            v_file ->> 'filename',
            v_status,
            (v_file ->> 'additions')::int,
            (v_file ->> 'deletions')::int
          );
        end loop;
      end if;
    end if;
  end loop;
  return v_added;
end;
$$;

create or replace function public.op_commit_count(p_repository_id uuid)
returns int
language plpgsql
stable
security definer
set search_path = private, public, pg_temp
as $$
begin
  perform private.assert_service();
  return (select count(*)::int from private.commits where repository_id = p_repository_id);
end;
$$;

create or replace function public.op_save_feature(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = private, public, pg_temp
as $$
declare
  v_id uuid;
begin
  perform private.assert_service();
  if p ? 'id' and nullif(p ->> 'id', '') is not null then
    update private.features set
      name = coalesce(p ->> 'name', name),
      description = case when p ? 'description' then p ->> 'description' else description end,
      show_in_showcase = coalesce((p ->> 'show_in_showcase')::boolean, show_in_showcase),
      position = coalesce((p ->> 'position')::int, position)
    where id = (p ->> 'id')::uuid
    returning id into v_id;
    return v_id;
  end if;
  insert into private.features (repository_id, name, description, show_in_showcase, position)
  values (
    (p ->> 'repository_id')::uuid,
    p ->> 'name',
    p ->> 'description',
    coalesce((p ->> 'show_in_showcase')::boolean, true),
    coalesce((p ->> 'position')::int, 0)
  ) returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.op_delete_feature(p_id uuid)
returns void
language plpgsql
security definer
set search_path = private, public, pg_temp
as $$
begin
  perform private.assert_service();
  delete from private.features where id = p_id;
end;
$$;

create or replace function public.op_set_showcase_message(p_id uuid, p_message text)
returns void
language plpgsql
security definer
set search_path = private, public, pg_temp
as $$
begin
  perform private.assert_service();
  update private.commits
  set showcase_message = nullif(p_message, '')
  where id = p_id;
end;
$$;

create or replace function public.op_acquire_slice(p_trigger text, p_repository_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = private, public, pg_temp
as $$
declare
  v_run uuid;
  v_repo private.repositories%rowtype;
  v_count int;
begin
  perform private.assert_service();
  if p_trigger not in ('reconcile', 'manual') then
    raise exception 'gatilho invalido';
  end if;

  update private.sync_runs
  set status = 'error', error = 'fatia interrompida', finished_at = now()
  where status = 'running' and started_at < now() - interval '2 minutes';

  if exists (select 1 from private.sync_runs where status = 'running') then
    return jsonb_build_object('already_running', true);
  end if;

  if p_repository_id is not null then
    select * into v_repo from private.repositories where id = p_repository_id and paused = false;
  else
    select * into v_repo from private.repositories
    where paused = false
    order by backfill_done asc, updated_at asc
    limit 1;
  end if;

  if v_repo.id is null then
    return jsonb_build_object('empty', true);
  end if;

  begin
    insert into private.sync_runs (trigger, repository_id, status)
    values (p_trigger, v_repo.id, 'running')
    returning id into v_run;
  exception when unique_violation then
    return jsonb_build_object('already_running', true);
  end;

  select count(*) into v_count from private.commits where repository_id = v_repo.id;

  return jsonb_build_object(
    'run_id', v_run,
    'commit_count', v_count,
    'repository', jsonb_build_object(
      'id', v_repo.id,
      'connection_id', v_repo.connection_id,
      'github_repo_id', v_repo.github_repo_id,
      'full_name', v_repo.full_name,
      'default_branch', v_repo.default_branch,
      'backfill_page', v_repo.backfill_page,
      'incremental_page', v_repo.incremental_page,
      'backfill_done', v_repo.backfill_done,
      'history_limit', v_repo.history_limit,
      'history_since', v_repo.history_since,
      'last_synced_sha', v_repo.last_synced_sha,
      'pending_tip_sha', v_repo.pending_tip_sha
    )
  );
end;
$$;

create or replace function public.op_finish_slice(
  p_run_id uuid,
  p_status text,
  p_pending boolean,
  p_repos_remaining int,
  p_commits_added int,
  p_error text
)
returns void
language plpgsql
security definer
set search_path = private, public, pg_temp
as $$
begin
  perform private.assert_service();
  update private.sync_runs set
    status = p_status,
    pending = p_pending,
    repos_remaining = p_repos_remaining,
    commits_added = p_commits_added,
    error = p_error,
    finished_at = now()
  where id = p_run_id and status = 'running';
end;
$$;

create or replace function public.op_repos_remaining()
returns int
language plpgsql
stable
security definer
set search_path = private, public, pg_temp
as $$
begin
  perform private.assert_service();
  return (
    select count(*)::int from private.repositories
    where paused = false
      and (
        backfill_done = false
        or last_remote_check_at is null
        or last_remote_check_at < now() - interval '13 minutes'
      )
  );
end;
$$;

create or replace function public.op_wake_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = private, public, pg_temp
as $$
declare
  v_remaining int;
  v_error boolean;
begin
  perform private.assert_service();
  v_remaining := public.op_repos_remaining();
  select coalesce(status = 'error', false) into v_error
  from private.sync_runs
  order by started_at desc
  limit 1;
  return jsonb_build_object(
    'pending', v_remaining > 0,
    'error', coalesce(v_error, false),
    'repos_remaining', v_remaining
  );
end;
$$;

create or replace function public.op_repository_by_github(p_github_repo_id bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = private, public, pg_temp
as $$
declare
  v jsonb;
begin
  perform private.assert_service();
  select jsonb_build_object(
    'id', id,
    'connection_id', connection_id,
    'full_name', full_name,
    'default_branch', default_branch,
    'github_hook_id', github_hook_id
  ) into v
  from private.repositories
  where github_repo_id = p_github_repo_id;
  return v;
end;
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

create or replace function public.op_record_webhook_run(p_repository_id uuid, p_added int, p_error text)
returns void
language plpgsql
security definer
set search_path = private, public, pg_temp
as $$
begin
  perform private.assert_service();
  insert into private.sync_runs (trigger, repository_id, status, pending, commits_added, error, finished_at)
  values (
    'webhook',
    p_repository_id,
    case when p_error is null then 'ok' else 'error' end,
    public.op_repos_remaining() > 0,
    p_added,
    p_error,
    now()
  );
end;
$$;

do $$
declare
  fn regprocedure;
begin
  foreach fn in array array[
    'public.op_store_connection(text,text,text)'::regprocedure,
    'public.op_delete_connection(uuid)'::regprocedure,
    'public.op_token(uuid)'::regprocedure,
    'public.op_webhook_secret(uuid)'::regprocedure,
    'public.op_store_webhook(uuid,text,bigint)'::regprocedure,
    'public.op_save_repository(jsonb)'::regprocedure,
    'public.op_patch_repository(uuid,jsonb)'::regprocedure,
    'public.op_save_languages(uuid,jsonb)'::regprocedure,
    'public.op_save_commits(uuid,jsonb)'::regprocedure,
    'public.op_commit_count(uuid)'::regprocedure,
    'public.op_save_feature(jsonb)'::regprocedure,
    'public.op_delete_feature(uuid)'::regprocedure,
    'public.op_set_showcase_message(uuid,text)'::regprocedure,
    'public.op_acquire_slice(text,uuid)'::regprocedure,
    'public.op_finish_slice(uuid,text,boolean,int,int,text)'::regprocedure,
    'public.op_repos_remaining()'::regprocedure,
    'public.op_wake_status()'::regprocedure,
    'public.op_repository_by_github(bigint)'::regprocedure,
    'public.op_record_webhook_run(uuid,int,text)'::regprocedure,
    'public.op_set_profile(uuid,text)'::regprocedure
  ]
  loop
    execute format('revoke all on function %s from public, anon, authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
end;
$$;
