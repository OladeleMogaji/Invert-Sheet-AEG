-- AEG Invert Sheet update: QA/QC approval.
-- Only supervisors and admins can approve or return a sheet, and an approved sheet
-- can't be changed by crew. Paste into Supabase > SQL Editor > New query > Run.
-- Safe to run more than once.

create or replace function public.guard_sheet_qa() returns trigger
language plpgsql security definer set search_path = public as $$
declare r text;
begin
  -- Changes made in the Supabase dashboard (no signed-in app user) are not restricted.
  if auth.uid() is null then return new; end if;
  r := public.my_role();
  if r in ('supervisor', 'admin') then return new; end if;

  if tg_op = 'UPDATE' then
    -- Crew can't change or delete an approved sheet: keep it exactly as approved.
    if old.data->'qa'->>'status' = 'approved' then
      return old;
    end if;
    -- Crew can't write a QA/QC decision: keep whatever the supervisor decided.
    new.data := jsonb_set(new.data, '{qa}', coalesce(old.data->'qa', 'null'::jsonb));
  else
    new.data := new.data - 'qa';
  end if;
  return new;
end $$;

drop trigger if exists sheets_guard_qa on public.sheets;
create trigger sheets_guard_qa before insert or update on public.sheets
  for each row execute function public.guard_sheet_qa();
