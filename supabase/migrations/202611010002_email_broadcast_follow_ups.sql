-- Bulk email gains follow-ups ("reminder"): personalised notes about each person's own application or account
-- (e.g. add the account username, put the code in the bio), sent to a quick view in the Workers directory.
alter table public.email_broadcasts drop constraint if exists email_broadcasts_kind_check;
alter table public.email_broadcasts add constraint email_broadcasts_kind_check check (kind in ('terms', 'reminder', 'promotion', 'announcement'));
-- Which quick view or filters picked the audience, for the history.
alter table public.email_broadcasts add column if not exists segment text check (segment is null or char_length(segment) <= 80);
notify pgrst, 'reload schema';
