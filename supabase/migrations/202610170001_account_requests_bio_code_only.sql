-- Additional account requests are verified by the code in the account's bio, so creators no longer send a login.
-- New requests store an empty email; older password-based requests keep theirs.

alter table public.social_account_requests alter column email set default '';
alter table public.social_account_requests drop constraint if exists social_account_requests_email_check;
alter table public.social_account_requests
  add constraint social_account_requests_email_check check (email = '' or char_length(email) between 3 and 254);
