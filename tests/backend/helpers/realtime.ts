/** Supabase's transactional Broadcast sink for local Postgres migration tests. */
export const realtimeTestSchema = `
  create schema realtime;
  create table realtime.messages(id uuid primary key default gen_random_uuid(),topic text,extension text default 'broadcast',event text,payload jsonb,private boolean);
  alter table realtime.messages enable row level security;
  create function realtime.send(payload jsonb,event text,topic text,private boolean) returns void language sql as
    $$insert into realtime.messages(payload,event,topic,private) values($1,$2,$3,$4)$$;
`;
