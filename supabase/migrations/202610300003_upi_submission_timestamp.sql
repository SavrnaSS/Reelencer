-- Preserve unknown historical save times. Only new or edited configurations get
-- a submission timestamp; a verification decision must not reset queue age.
alter table public.upi_configs add column if not exists updated_at timestamptz;
alter table public.upi_configs alter column updated_at set default now();

create or replace function public.touch_upi_submission_timestamp() returns trigger
language plpgsql set search_path='' as $$
begin
  if TG_OP='INSERT' then
    NEW.updated_at:=clock_timestamp();
  elsif (NEW.upi_id,NEW.payout_schedule,NEW.payout_day) is distinct from
        (OLD.upi_id,OLD.payout_schedule,OLD.payout_day) then
    NEW.updated_at:=clock_timestamp();
  else
    NEW.updated_at:=OLD.updated_at;
  end if;
  return NEW;
end; $$;
revoke all on function public.touch_upi_submission_timestamp() from public,anon,authenticated;
drop trigger if exists upi_submission_timestamp on public.upi_configs;
create trigger upi_submission_timestamp before insert or update on public.upi_configs
  for each row execute function public.touch_upi_submission_timestamp();
