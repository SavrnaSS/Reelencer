-- Gig work on the admin live channel (see 202610110002): applications (incl. instant Email Creator approvals),
-- assignments (starting work, submissions, reviews) and submitted account credentials signal the admin consoles
-- once per change, with no row contents.
do $$
declare t text;
begin
  foreach t in array array['gig_applications', 'gig_assignments', 'gig_account_credentials'] loop
    execute format('drop trigger if exists admin_live_update on public.%I', t);
    execute format('create trigger admin_live_update after insert or update or delete on public.%I for each statement execute function public.notify_admin_live()', t);
  end loop;
end $$;
