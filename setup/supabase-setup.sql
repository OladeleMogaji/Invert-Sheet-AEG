-- =====================================================================
-- AEG Invert Sheet: one-time Supabase setup
-- Paste this whole file into Supabase > SQL Editor > New query > Run.
-- Safe to run again: it only creates what is missing.
-- =====================================================================

-- 1. People who can use the app, and their role --------------------------
create table if not exists public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  email      text,
  full_name  text,
  role       text not null default 'crew' check (role in ('crew','supervisor','admin')),
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;

-- Role of whoever is signed in (null if they have no profile)
create or replace function public.my_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid()
$$;

drop policy if exists "Team can see team" on public.profiles;
create policy "Team can see team" on public.profiles
  for select to authenticated using (public.my_role() is not null);

-- Every user added in Authentication gets a profile automatically
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email,
          coalesce(nullif(new.raw_user_meta_data->>'full_name',''), split_part(new.email,'@',1)))
  on conflict (id) do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Profiles for anyone added before this script ran
insert into public.profiles (id, email, full_name)
select id, email, split_part(email,'@',1) from auth.users
on conflict (id) do nothing;

-- 2. Invert sheets --------------------------------------------------------
create table if not exists public.sheets (
  id                text primary key,
  job_no            text,
  point_no          text,
  data              jsonb not null,
  updated_at        timestamptz not null,
  deleted           boolean not null default false,
  created_by        uuid references auth.users(id) default auth.uid(),
  updated_by        uuid references auth.users(id),
  server_updated_at timestamptz not null default clock_timestamp()
);
create index if not exists sheets_server_updated_at on public.sheets (server_updated_at);
create index if not exists sheets_job_point on public.sheets (job_no, point_no);
alter table public.sheets enable row level security;

drop policy if exists "Team can read sheets" on public.sheets;
create policy "Team can read sheets" on public.sheets
  for select to authenticated using (public.my_role() is not null);
drop policy if exists "Team can add sheets" on public.sheets;
create policy "Team can add sheets" on public.sheets
  for insert to authenticated with check (public.my_role() is not null);
drop policy if exists "Team can update sheets" on public.sheets;
create policy "Team can update sheets" on public.sheets
  for update to authenticated using (public.my_role() is not null) with check (public.my_role() is not null);

-- Save a sheet. The most recent edit wins: an older copy never overwrites a newer one.
-- Returns the sheet as stored, so the app can tell when someone else's edit is newer.
create or replace function public.push_sheet(p_id text, p_data jsonb, p_updated_at timestamptz, p_deleted boolean default false)
returns public.sheets
language plpgsql security invoker set search_path = public as $$
declare r public.sheets;
begin
  if public.my_role() is null then
    raise exception 'Your account is not set up for AEG Invert Sheet yet';
  end if;
  insert into public.sheets as s (id, job_no, point_no, data, updated_at, deleted, created_by, updated_by, server_updated_at)
  values (p_id, p_data->>'jobNo', p_data->>'pointNo', p_data, p_updated_at, p_deleted, auth.uid(), auth.uid(), clock_timestamp())
  on conflict (id) do update
    set job_no = excluded.job_no, point_no = excluded.point_no, data = excluded.data,
        updated_at = excluded.updated_at, deleted = excluded.deleted,
        updated_by = auth.uid(), server_updated_at = clock_timestamp()
    where s.updated_at <= excluded.updated_at;
  select * into r from public.sheets where id = p_id;
  return r;
end $$;
grant execute on function public.push_sheet(text, jsonb, timestamptz, boolean) to authenticated;

-- 3. Photo storage (private) ---------------------------------------------
insert into storage.buckets (id, name, public)
values ('photos', 'photos', false)
on conflict (id) do nothing;

drop policy if exists "Team can view photos" on storage.objects;
create policy "Team can view photos" on storage.objects
  for select to authenticated using (bucket_id = 'photos' and public.my_role() is not null);
drop policy if exists "Team can add photos" on storage.objects;
create policy "Team can add photos" on storage.objects
  for insert to authenticated with check (bucket_id = 'photos' and public.my_role() is not null);
drop policy if exists "Team can replace photos" on storage.objects;
create policy "Team can replace photos" on storage.objects
  for update to authenticated using (bucket_id = 'photos' and public.my_role() is not null);
drop policy if exists "Team can remove photos" on storage.objects;
create policy "Team can remove photos" on storage.objects
  for delete to authenticated using (bucket_id = 'photos' and public.my_role() is not null);

-- 4. Own passwords (added 2026-10-30) ------------------------------------
alter table public.profiles add column if not exists password_set boolean not null default false;

-- Lets a signed-in person mark that they've chosen their own password (and nothing else).
create or replace function public.mark_password_set() returns void
language sql security definer set search_path = public as $$
  update public.profiles set password_set = true where id = auth.uid()
$$;
grant execute on function public.mark_password_set() to authenticated;

-- Admins who already chose their own password don't need to be asked again.
-- (Remove this line if you want everyone, including admins, to pick a new one.)
update public.profiles set password_set = true where role = 'admin';
