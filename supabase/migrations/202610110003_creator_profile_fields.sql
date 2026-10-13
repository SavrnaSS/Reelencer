-- Creator profile details shown to brands (headline, location, bio). The dashboard's profile readiness counted
-- these but nothing stored them. They live on profiles (every creator has one; not every creator has a workers
-- row) and stay server-only: the existing column-level browser grant on profiles doesn't include them.
alter table public.profiles add column if not exists headline text not null default '' check (char_length(headline) <= 120);
alter table public.profiles add column if not exists city text not null default '' check (char_length(city) <= 80);
alter table public.profiles add column if not exists bio text not null default '' check (char_length(bio) <= 600);
