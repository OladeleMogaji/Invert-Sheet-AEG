-- AEG Invert Sheet: deleting projects (app version 2.9.0)
-- Run once in Supabase → SQL Editor → New query → paste → Run. Safe to run again.
--
-- What it does
--  1. Only an ADMIN can delete, restore or delete-forever a project. If anyone else's
--     device sends those changes, the database quietly keeps the project as it was.
--  2. Every delete / restore / delete-forever is written to the table "project_log"
--     with the person's name and the time. Nobody can edit or remove log rows from the app.
--     See it in Table Editor → project_log.

-- 1. The log ---------------------------------------------------------------
create table if not exists public.project_log (
  id           bigint generated always as identity primary key,
  at           timestamptz not null default now(),
  action       text not null,          -- 'deleted', 'restored', 'deleted forever'
  job_no       text,
  project_name text,
  record_id    text,
  by_id        uuid,
  by_name      text
);
alter table public.project_log enable row level security;
drop policy if exists "Team can read project log" on public.project_log;
create policy "Team can read project log" on public.project_log
  for select to authenticated using (public.my_role() is not null);
-- No insert/update/delete policies: only the trigger below can write to the log.

-- 2. The guard + logging trigger -------------------------------------------
create or replace function public.guard_project_delete() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  who text;
  act text;
  was_trash boolean := false;
  was_purged boolean := false;
  is_trash boolean;
  is_purged boolean;
begin
  -- only project records (one per AEG job number) are affected
  if coalesce(new.data->>'kind', '') <> 'project'
     and (tg_op = 'INSERT' or coalesce(old.data->>'kind', '') <> 'project') then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    was_trash  := coalesce(jsonb_typeof(old.data->'trash')  = 'object', false);
    was_purged := coalesce(jsonb_typeof(old.data->'purged') = 'object', false);
  end if;

  -- non-admins (crew, supervisors) can't change the delete state
  if auth.uid() is not null and coalesce(public.my_role(), '') <> 'admin' then
    if tg_op = 'UPDATE' then
      new.data := jsonb_set(jsonb_set(new.data, '{trash}', coalesce(old.data->'trash', 'null'::jsonb)),
                            '{purged}', coalesce(old.data->'purged', 'null'::jsonb));
      new.deleted := old.deleted;
    else
      new.data := new.data - 'trash' - 'purged';
    end if;
  end if;

  is_trash  := coalesce(jsonb_typeof(new.data->'trash')  = 'object', false);
  is_purged := coalesce(jsonb_typeof(new.data->'purged') = 'object', false);

  if tg_op = 'INSERT' then
    -- an upsert of an existing row is logged by the UPDATE that follows
    if exists (select 1 from public.sheets where id = new.id) then return new; end if;
    if is_purged then act := 'deleted forever';
    elsif is_trash then act := 'deleted';
    end if;
  else
    if is_purged and not was_purged then act := 'deleted forever';
    elsif is_trash and not was_trash then act := 'deleted';
    elsif was_trash and not is_trash and not is_purged then act := 'restored';
    elsif coalesce(new.deleted, false) and not coalesce(old.deleted, false) then act := 'record removed';
    end if;
  end if;

  if act is not null then
    select full_name into who from public.profiles where id = auth.uid();
    insert into public.project_log (action, job_no, project_name, record_id, by_id, by_name)
    values (act,
            coalesce(new.data->>'jobNo', old.data->>'jobNo'),
            coalesce(new.data->>'project', old.data->>'project'),
            new.id, auth.uid(), coalesce(who, '(unknown)'));
  end if;
  return new;
end $$;

drop trigger if exists sheets_guard_project_delete on public.sheets;
create trigger sheets_guard_project_delete before insert or update on public.sheets
  for each row execute function public.guard_project_delete();
