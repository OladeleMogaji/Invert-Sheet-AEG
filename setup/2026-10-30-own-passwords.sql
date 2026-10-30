-- AEG Invert Sheet update: people choose their own password on first sign-in.
-- Paste into Supabase > SQL Editor > New query > Run. Safe to run more than once.

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
