-- AEG Invert Sheet update: simple supervisor sign-off.
-- Signed sheets are no longer locked; only supervisors and admins can add or change
-- the sign-off (comment + signature). Replaces the 2026-11-02 approval rule.
-- Paste into Supabase > SQL Editor > New query > Run. Safe to run more than once.

create or replace function public.guard_sheet_qa() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- Changes made in the Supabase dashboard (no signed-in app user) are not restricted.
  if auth.uid() is null then return new; end if;
  if public.my_role() in ('supervisor', 'admin') then return new; end if;
  -- Crew can edit the sheet but can't add, change or remove a supervisor's sign-off.
  if tg_op = 'UPDATE' then
    new.data := jsonb_set(new.data, '{qa}', coalesce(old.data->'qa', 'null'::jsonb));
  else
    new.data := new.data - 'qa';
  end if;
  return new;
end $$;

drop trigger if exists sheets_guard_qa on public.sheets;
create trigger sheets_guard_qa before insert or update on public.sheets
  for each row execute function public.guard_sheet_qa();
