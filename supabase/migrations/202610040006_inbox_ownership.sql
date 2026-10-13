-- Reserve email addresses across both inbox workflows, including secondary gig addresses.
-- Deleted addresses stay reserved so a later account cannot receive the former owner's mail.
create table if not exists public.inbox_recipients (
  email text primary key check(email=lower(trim(email))),
  gig_assignment_id uuid references public.gig_assignments(id) on delete set null,
  work_email_account_id uuid references public.work_email_accounts(id) on delete set null,
  created_at timestamptz not null default now(),
  check(num_nonnulls(gig_assignment_id,work_email_account_id)<=1)
);
alter table public.inbox_recipients enable row level security;
revoke all on public.inbox_recipients from public,anon,authenticated;
grant all on public.inbox_recipients to service_role;

create or replace function public.reserve_inbox_recipient() returns trigger
language plpgsql security definer set search_path='' as $$
declare address text; addresses jsonb; existing public.inbox_recipients%rowtype;
begin
  if tg_table_name='gig_assignments' then
    if tg_op='UPDATE' and (new.assigned_email is distinct from old.assigned_email or new.assigned_emails is distinct from old.assigned_emails) then raise exception 'invalid_transition'; end if;
    addresses:=coalesce(new.assigned_emails,'[]'::jsonb)||jsonb_build_array(new.assigned_email);
  else
    if tg_op='UPDATE' and new.email is distinct from old.email then raise exception 'invalid_transition'; end if;
    addresses:=jsonb_build_array(new.email);
  end if;
  for address in select distinct lower(trim(value)) from jsonb_array_elements_text(addresses) order by 1 loop
    if address is null or address='' then raise exception 'invalid_accounts'; end if;
    insert into public.inbox_recipients(email,gig_assignment_id,work_email_account_id)
      values(address,case when tg_table_name='gig_assignments' then new.id end,case when tg_table_name='work_email_accounts' then new.id end)
      on conflict(email) do nothing;
    select * into existing from public.inbox_recipients where email=address for update;
    if (tg_table_name='gig_assignments' and existing.gig_assignment_id is distinct from new.id)
      or (tg_table_name='work_email_accounts' and existing.work_email_account_id is distinct from new.id)
      then raise unique_violation using message='Email address is already reserved'; end if;
  end loop;
  return new;
end; $$;
revoke all on function public.reserve_inbox_recipient() from public,anon,authenticated;
grant execute on function public.reserve_inbox_recipient() to service_role;
drop trigger if exists reserve_gig_inbox on public.gig_assignments;
create trigger reserve_gig_inbox after insert or update of assigned_email,assigned_emails on public.gig_assignments
  for each row execute function public.reserve_inbox_recipient();
drop trigger if exists reserve_work_inbox on public.work_email_accounts;
create trigger reserve_work_inbox after insert or update of email on public.work_email_accounts
  for each row execute function public.reserve_inbox_recipient();
-- A conflicting legacy address aborts the migration rather than guessing its owner.
update public.gig_assignments set assigned_email=assigned_email;
update public.work_email_accounts set email=email;

create or replace function public.reelencer_backend_version() returns integer language sql stable set search_path='' as $$select 2$$;
