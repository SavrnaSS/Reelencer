-- Reconcile the earlier Reelencer schema before installing the canonical baseline.
-- The migration runner commits this and 001-007 in a single transaction. No rows
-- are deleted, and unrelated tables (including quoted CamelCase tables) are untouched.
-- Invalid identities, dates, UUIDs, duplicate keys and orphan ownership references
-- abort. Historical KYC audit events whose former KYC row or Auth actor was
-- deleted are retained behind NOT VALID foreign keys that enforce future writes.

-- Older browser policies can depend on an enum/array column's original type.
-- Migration 005 installs the canonical permissions in this same transaction.
do $$
declare target text; policy record;
begin
  foreach target in array array['profiles','workers','accounts','assignments','worker_account_assignments','worker_accounts',
    'work_items','work_item_audit','gigs','gig_applications','gig_assignments','gig_account_credentials','gig_inbox',
    'worker_kyc','worker_kyc_events','upi_configs','payout_batches','payout_items','work_email_secret_codes',
    'work_email_accounts','work_email_inbox','dashboard_feedback','api_rate_limits','audit_events'] loop
    if to_regclass(format('public.%I',target)) is null then continue; end if;
    for policy in select policyname from pg_policies where schemaname='public' and tablename=target loop
      execute format('drop policy %I on public.%I',policy.policyname,target);
    end loop;
  end loop;
end $$;

-- Convert enum labels without changing their values, restoring defaults and
-- preserving existing CHECK predicates with the enum casts changed to text.
do $$
declare target record; kind "char"; enum_name text; old_default text; constraint_row record; preserved_checks jsonb; check_row jsonb;
begin
  for target in select * from (values
    ('profiles','role'),('accounts','policy_tier'),('accounts','health'),
    ('work_items','type'),('work_items','status'),('work_items','priority'),
    ('upi_configs','payout_schedule'),('payout_batches','status'),('payout_items','status')
  ) as columns_to_convert(table_name,column_name) loop
    select t.typtype,t.typname,pg_get_expr(d.adbin,d.adrelid)
      into kind,enum_name,old_default
      from pg_attribute a join pg_type t on t.oid=a.atttypid
      left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
      where a.attrelid=to_regclass(format('public.%I',target.table_name))
        and a.attname=target.column_name and not a.attisdropped;
    if not found or kind<>'e' then continue; end if;
    preserved_checks:='[]'::jsonb;
    for constraint_row in
      select c.conname,pg_get_constraintdef(c.oid) as definition
      from pg_constraint c join pg_attribute a on a.attrelid=c.conrelid and a.attnum=any(c.conkey)
      where c.conrelid=to_regclass(format('public.%I',target.table_name))
        and a.attname=target.column_name and c.contype='c'
    loop
      preserved_checks:=preserved_checks||jsonb_build_array(jsonb_build_object(
        'name',constraint_row.conname,
        'definition',regexp_replace(constraint_row.definition,
          '::(public\.)?'||enum_name||'\M','::text','g')));
      execute format('alter table public.%I drop constraint %I',target.table_name,constraint_row.conname);
    end loop;
    execute format('alter table public.%I alter column %I drop default',target.table_name,target.column_name);
    execute format('alter table public.%I alter column %I type text using %I::text',target.table_name,target.column_name,target.column_name);
    if old_default is not null then
      execute format('alter table public.%I alter column %I set default (%s)::text',target.table_name,target.column_name,old_default);
    end if;
    for check_row in select value from jsonb_array_elements(preserved_checks) loop
      execute format('alter table public.%I add constraint %I %s',target.table_name,check_row->>'name',check_row->>'definition');
    end loop;
  end loop;
end $$;

-- The original required Auth identity column is renamed, retaining its values,
-- Auth foreign key and unique constraint instead of introducing a second identity.
do $$
begin
  if to_regclass('public.workers') is not null then
    if exists(select 1 from information_schema.columns where table_schema='public' and table_name='workers' and column_name='auth_user_id') then
      if exists(select 1 from information_schema.columns where table_schema='public' and table_name='workers' and column_name='user_id') then
        if exists(select 1 from public.workers where auth_user_id is distinct from user_id) then
          raise exception 'Legacy worker identity columns disagree; reconcile before migration';
        end if;
        -- Keep an existing duplicate legacy column, but allow canonical inserts.
        alter table public.workers alter column auth_user_id drop not null;
      else
        alter table public.workers rename column auth_user_id to user_id;
      end if;
    end if;
  end if;
end $$;

-- Resolve text aliases through established identities. A helper in the temporary
-- schema avoids a persistent function and rejects ambiguous or unknown aliases.
create temporary table _reelencer_compat_worker_aliases(alias text not null,user_id uuid not null) on commit drop;
do $$
begin
  if to_regclass('public.profiles') is not null then
    insert into _reelencer_compat_worker_aliases select id::text,id from public.profiles;
    if exists(select 1 from information_schema.columns where table_schema='public' and table_name='profiles' and column_name='worker_code') then
      insert into _reelencer_compat_worker_aliases select worker_code,id from public.profiles where worker_code is not null;
    end if;
  end if;
  if exists(select 1 from information_schema.columns where table_schema='public' and table_name='workers' and column_name='user_id') then
    insert into _reelencer_compat_worker_aliases select id,user_id from public.workers where user_id is not null;
    insert into _reelencer_compat_worker_aliases select user_id::text,user_id from public.workers where user_id is not null;
  end if;
end $$;
create or replace function pg_temp.reelencer_resolve_worker_alias(worker_alias text) returns uuid
language plpgsql stable set search_path='' as $$
declare identities uuid[];
begin
  select array_agg(distinct user_id) into identities from pg_temp._reelencer_compat_worker_aliases where alias=worker_alias;
  if coalesce(cardinality(identities),0)<>1 then
    raise exception 'Legacy worker alias is missing or ambiguous; reconcile before migration';
  end if;
  return identities[1];
end $$;

-- Some early worker/account links have no surviving owner or account. Preserve
-- the complete original relation as a protected archive instead of inventing
-- identities, inventing accounts, or deleting links to force a conversion.
do $$
declare actual_type text; needs_archive boolean;
begin
  select udt_name into actual_type from information_schema.columns
    where table_schema='public' and table_name='worker_accounts' and column_name='worker_id';
  if not found or actual_type<>'text' then return; end if;
  if to_regclass('public.accounts') is null or to_regclass('public.profiles') is null then
    raise exception 'Legacy worker/account links require their parent schemas';
  end if;
  select exists(select 1 from public.worker_accounts link
    where (select count(distinct user_id) from pg_temp._reelencer_compat_worker_aliases where alias=link.worker_id)<>1
      or not exists(select 1 from public.accounts account where account.id=link.account_id)
      or not exists(select 1 from public.profiles profile join pg_temp._reelencer_compat_worker_aliases identity
        on identity.user_id=profile.id where identity.alias=link.worker_id)) into needs_archive;
  if not needs_archive then return; end if;
  if to_regclass('public.legacy_worker_accounts') is not null then
    raise exception 'Legacy worker/account archive already exists; reconcile before migration';
  end if;
  alter table public.worker_accounts rename to legacy_worker_accounts;
  alter table public.legacy_worker_accounts enable row level security;
  revoke all on public.legacy_worker_accounts from public,anon,authenticated,service_role;
  grant select on public.legacy_worker_accounts to service_role;
  create table public.worker_accounts (
    worker_id uuid not null references public.profiles(id),
    account_id text not null references public.accounts(id),
    constraint reelencer_worker_accounts_canonical_pkey primary key(worker_id,account_id)
  );
  insert into public.worker_accounts(worker_id,account_id)
    select distinct identity.user_id,link.account_id
    from public.legacy_worker_accounts link
    join (select alias,(array_agg(distinct user_id))[1] as user_id
      from pg_temp._reelencer_compat_worker_aliases group by alias having count(distinct user_id)=1) identity
      on identity.alias=link.worker_id
    join public.profiles profile on profile.id=identity.user_id
    join public.accounts account on account.id=link.account_id;
end $$;

do $$
declare target text; actual_type text; constraint_row record;
begin
  if to_regclass('public.assignments') is not null then
    if exists(select 1 from information_schema.columns where table_schema='public' and table_name='assignments' and column_name='workerid') then
      if exists(select 1 from information_schema.columns where table_schema='public' and table_name='assignments' and column_name='worker_id') then
        raise exception 'Legacy assignments have two worker identity columns; reconcile before migration';
      end if;
      alter table public.assignments rename column workerid to worker_id;
    end if;
    if exists(select 1 from information_schema.columns where table_schema='public' and table_name='assignments' and column_name='accountid') then
      if exists(select 1 from information_schema.columns where table_schema='public' and table_name='assignments' and column_name='account_id') then
        raise exception 'Legacy assignments have two account identity columns; reconcile before migration';
      end if;
      alter table public.assignments rename column accountid to account_id;
    end if;
  end if;
  foreach target in array array['assignments','worker_accounts'] loop
    select udt_name into actual_type from information_schema.columns
      where table_schema='public' and table_name=target and column_name='worker_id';
    if not found or actual_type='uuid' then continue; end if;
    if actual_type<>'text' then raise exception 'Unsupported legacy worker identity type'; end if;
    -- Old assignment FKs pointed to the public worker code, not the Auth UUID.
    for constraint_row in
      select distinct c.conname from pg_constraint c join pg_attribute a on a.attrelid=c.conrelid and a.attnum=any(c.conkey)
      where c.conrelid=to_regclass(format('public.%I',target)) and c.contype='f' and a.attname='worker_id'
    loop
      execute format('alter table public.%I drop constraint %I',target,constraint_row.conname);
    end loop;
    execute format('alter table public.%I alter column worker_id type uuid using pg_temp.reelencer_resolve_worker_alias(worker_id)',target);
  end loop;
end $$;

-- Preserve SQL arrays as JSON arrays, including secondary gig inbox addresses.
do $$
declare target record; actual_type text; old_default text; fallback text;
begin
  for target in select * from (values
    ('accounts','rules'),('accounts','allowed_audios'),('accounts','required_hashtags'),
    ('gigs','requirements'),('gig_assignments','assigned_emails')
  ) as arrays_to_convert(table_name,column_name) loop
    select t.typname,pg_get_expr(d.adbin,d.adrelid) into actual_type,old_default
      from pg_attribute a join pg_type t on t.oid=a.atttypid
      left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
      where a.attrelid=to_regclass(format('public.%I',target.table_name)) and a.attname=target.column_name and not a.attisdropped;
    if not found or actual_type='jsonb' then continue; end if;
    if actual_type<>'_text' then raise exception 'Unsupported legacy array type'; end if;
    execute format('alter table public.%I alter column %I drop default',target.table_name,target.column_name);
    execute format('alter table public.%I alter column %I type jsonb using coalesce(to_jsonb(%I),''[]''::jsonb)',target.table_name,target.column_name,target.column_name);
    if old_default is null then fallback:='''[]''::jsonb'; else fallback:=format('coalesce(to_jsonb(%s),''[]''::jsonb)',old_default); end if;
    execute format('alter table public.%I alter column %I set default %s',target.table_name,target.column_name,fallback);
    execute format('alter table public.%I alter column %I set not null',target.table_name,target.column_name);
  end loop;
end $$;

do $$
declare constraint_row record; original_type text; suffix_max bigint; sequence_value bigint; new_details boolean; new_actor boolean; new_created boolean;
begin
  if to_regclass('public.profiles') is not null then
    create sequence if not exists public.worker_code_sequence start 1001;
    if exists(select 1 from public.profiles where worker_code ~ '^WKR-[0-9]+$' and length(substring(worker_code from 5))>18) then
      raise exception 'Worker code suffix exceeds the supported sequence range';
    end if;
    select coalesce(max(substring(worker_code from 5)::bigint),1000) into suffix_max
      from public.profiles where worker_code ~ '^WKR-[0-9]+$';
    select last_value into sequence_value from public.worker_code_sequence;
    perform setval('public.worker_code_sequence',greatest(suffix_max,sequence_value,1000),true);
    alter table public.profiles alter column worker_code set default ('WKR-'||nextval('public.worker_code_sequence'));
  end if;
  if to_regclass('public.accounts') is not null then
    alter table public.accounts add column if not exists schedule jsonb;
    alter table public.accounts add column if not exists schedule_morning text;
    alter table public.accounts add column if not exists schedule_evening text;
    alter table public.accounts add column if not exists deadline_minutes integer;
    alter table public.accounts add column if not exists schedule_days integer[];
    alter table public.accounts add column if not exists schedule_timezone text;
    alter table public.accounts add column if not exists timezone text;
  end if;
  if to_regclass('public.assignments') is not null then
    alter table public.assignments add column if not exists id uuid not null default gen_random_uuid();
    alter table public.assignments add column if not exists schedule jsonb;
    alter table public.assignments add column if not exists assigned_by uuid references auth.users(id);
    -- Retain the original composite primary key, which is already a stronger
    -- worker/account uniqueness contract, and expose a unique canonical ID.
    create unique index if not exists reelencer_assignments_id_unique on public.assignments(id);
  end if;
  if to_regclass('public.worker_account_assignments') is not null then
    alter table public.worker_account_assignments add column if not exists schedule jsonb;
    if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='worker_account_assignments' and column_name='created_at') then
      alter table public.worker_account_assignments add column created_at timestamptz;
      if exists(select 1 from information_schema.columns where table_schema='public' and table_name='worker_account_assignments' and column_name='assigned_at') then
        update public.worker_account_assignments set created_at=assigned_at;
      else
        update public.worker_account_assignments set created_at=now();
      end if;
      alter table public.worker_account_assignments alter column created_at set default now();
      alter table public.worker_account_assignments alter column created_at set not null;
    end if;
  end if;
  if to_regclass('public.work_items') is not null then
    alter table public.work_items add column if not exists audit jsonb not null default '[]';
    alter table public.work_items alter column type set default 'Reel posting';
    alter table public.work_items alter column account_id drop not null;
    alter table public.work_items alter column due_at drop not null;
    alter table public.work_items alter column reward_inr type numeric(12,2) using reward_inr::numeric(12,2);
    select udt_name into original_type from information_schema.columns where table_schema='public' and table_name='work_items' and column_name='created_by';
    if original_type='uuid' then
      for constraint_row in select distinct c.conname from pg_constraint c join pg_attribute a on a.attrelid=c.conrelid and a.attnum=any(c.conkey)
        where c.conrelid='public.work_items'::regclass and c.contype='f' and a.attname='created_by' loop
        execute format('alter table public.work_items drop constraint if exists %I',constraint_row.conname);
      end loop;
      alter table public.work_items alter column created_by type text using created_by::text;
    end if;
    if exists(select 1 from public.work_items where public_id is null) then raise exception 'Legacy work item has no public ID; reconcile before migration'; end if;
    alter table public.work_items alter column public_id set not null;
  end if;
  if to_regclass('public.work_item_audit') is not null then
    new_details:=not exists(select 1 from information_schema.columns where table_schema='public' and table_name='work_item_audit' and column_name='details');
    new_actor:=not exists(select 1 from information_schema.columns where table_schema='public' and table_name='work_item_audit' and column_name='actor_id');
    new_created:=not exists(select 1 from information_schema.columns where table_schema='public' and table_name='work_item_audit' and column_name='created_at');
    alter table public.work_item_audit add column if not exists actor_id uuid;
    alter table public.work_item_audit add column if not exists action text not null default 'legacy_event';
    alter table public.work_item_audit add column if not exists details jsonb not null default '{}';
    alter table public.work_item_audit add column if not exists created_at timestamptz not null default now();
    if new_actor and exists(select 1 from information_schema.columns where table_schema='public' and table_name='work_item_audit' and column_name='by_profile') then
      update public.work_item_audit set actor_id=by_profile;
    end if;
    if new_created and exists(select 1 from information_schema.columns where table_schema='public' and table_name='work_item_audit' and column_name='at') then
      update public.work_item_audit set created_at=at;
    end if;
    if new_details and exists(select 1 from information_schema.columns where table_schema='public' and table_name='work_item_audit' and column_name='text') then
      update public.work_item_audit set details=jsonb_build_object('legacyText',text);
      if exists(select 1 from information_schema.columns where table_schema='public' and table_name='work_item_audit' and column_name='by_label') then
        update public.work_item_audit set details=details||jsonb_build_object('legacyActorLabel',by_label);
      end if;
    end if;
    if exists(select 1 from information_schema.columns where table_schema='public' and table_name='work_item_audit' and column_name='text') then
      alter table public.work_item_audit alter column text set default '';
    end if;
    if exists(select 1 from information_schema.columns where table_schema='public' and table_name='work_item_audit' and column_name='by_label') then
      alter table public.work_item_audit alter column by_label set default '';
    end if;
  end if;
  if to_regclass('public.gigs') is not null then
    alter table public.gigs alter column id set default gen_random_uuid()::text;
    if exists(select 1 from public.gigs where gig_type is null) then raise exception 'Legacy gig type is missing; reconcile before migration'; end if;
    alter table public.gigs alter column gig_type set not null;
  end if;
  if to_regclass('public.gig_applications') is not null then
    select udt_name into original_type from information_schema.columns where table_schema='public' and table_name='gig_applications' and column_name='id';
    if original_type='text' then
      if exists(select 1 from public.gig_applications where not pg_input_is_valid(id,'uuid')) then
        raise exception 'Legacy application ID is not a UUID; an explicit reversible ID mapping is required';
      end if;
      alter table public.gig_applications alter column id drop default;
      alter table public.gig_applications alter column id type uuid using id::uuid;
    elsif original_type<>'uuid' then raise exception 'Unsupported application ID type'; end if;
    alter table public.gig_applications alter column id set default gen_random_uuid();
  end if;
  if to_regclass('public.gig_inbox') is not null then
    alter table public.gig_inbox alter column subject set default '';
    alter table public.gig_inbox alter column body set default '';
    alter table public.gig_inbox alter column message_id set not null;
  end if;
  if to_regclass('public.worker_kyc') is not null then
    select udt_name into original_type from information_schema.columns where table_schema='public' and table_name='worker_kyc' and column_name='dob';
    if original_type='text' then
      if exists(select 1 from public.worker_kyc where not pg_input_is_valid(dob,'date')) then
        raise exception 'Legacy KYC date is invalid; reconcile before migration';
      end if;
      alter table public.worker_kyc alter column dob type date using dob::date;
    elsif original_type<>'date' then raise exception 'Unsupported KYC date type'; end if;
    alter table public.worker_kyc alter column id_doc_path set not null;
    alter table public.worker_kyc alter column selfie_path set not null;
  end if;
  if to_regclass('public.payout_items') is not null then
    alter table public.payout_items alter column amount_inr type numeric(12,2) using amount_inr::numeric(12,2);
    -- Historic manual payout lines can legitimately lack a work_item_id. Keep
    -- that history; the payout transaction validates IDs for newly reserved work.
  end if;
end $$;

-- Constraints are installed only on already-existing tables. The following
-- baseline creates them directly for fresh tables. Validation rejects conflicting
-- legacy data; no deduplication or guessed ownership is performed here.
create or replace function pg_temp.reelencer_compat_constraint(target text,constraint_name text,definition text) returns void
language plpgsql set search_path='' as $$
declare table_oid regclass; unique_match text[]; foreign_match text[]; expected_columns text[]; referenced_columns text[]; referenced_table regclass; matching_foreign record;
begin
  table_oid:=to_regclass(format('public.%I',target));
  if table_oid is null then return; end if;
  unique_match:=regexp_match(definition,'^unique\(([^)]+)\)$');
  if unique_match is not null then
    expected_columns:=string_to_array(replace(unique_match[1],' ',''),',');
    -- Standalone unique indexes satisfy ON CONFLICT too. Reuse them, including
    -- the older gig_applications_unique/gig_assignments_unique/message index.
    if exists(select 1 from pg_index i where i.indrelid=table_oid and i.indisunique and i.indisvalid
      and i.indpred is null and i.indexprs is null and i.indnkeyatts=cardinality(expected_columns)
      and (select array_agg(a.attname::text order by k.position)
        from unnest(i.indkey::smallint[]) with ordinality k(attnum,position)
        join pg_attribute a on a.attrelid=i.indrelid and a.attnum=k.attnum
        where k.position<=i.indnkeyatts)=expected_columns) then return; end if;
  end if;
  foreign_match:=regexp_match(definition,'^foreign key\(([^)]+)\) references public\.([a-z_]+)\(([^)]+)\)(.*)$');
  if foreign_match is not null then
    expected_columns:=string_to_array(replace(foreign_match[1],' ',''),',');
    referenced_table:=to_regclass(format('public.%I',foreign_match[2]));
    referenced_columns:=string_to_array(replace(foreign_match[3],' ',''),',');
    for matching_foreign in select c.conname,c.convalidated from pg_constraint c where c.conrelid=table_oid and c.contype='f' and c.confrelid=referenced_table
      and (select array_agg(a.attname::text order by k.position) from unnest(c.conkey) with ordinality k(attnum,position)
        join pg_attribute a on a.attrelid=c.conrelid and a.attnum=k.attnum)=expected_columns
      and (select array_agg(a.attname::text order by k.position) from unnest(c.confkey) with ordinality k(attnum,position)
        join pg_attribute a on a.attrelid=c.confrelid and a.attnum=k.attnum)=referenced_columns
      and c.confdeltype=case when foreign_match[4] like '%on delete cascade%' then 'c' else 'a' end
    loop
      if not matching_foreign.convalidated and foreign_match[4] not like '%not valid%' then
        execute format('alter table public.%I validate constraint %I',target,matching_foreign.conname);
      end if;
      return;
    end loop;
  end if;
  if not exists(select 1 from pg_constraint where conrelid=table_oid and conname=constraint_name) then
    execute format('alter table public.%I add constraint %I %s',target,constraint_name,definition);
  end if;
end $$;

select pg_temp.reelencer_compat_constraint('workers','reelencer_workers_profile_fkey','foreign key(user_id) references public.profiles(id) on delete cascade');
select pg_temp.reelencer_compat_constraint('workers','reelencer_workers_user_id_key','unique(user_id)');
select pg_temp.reelencer_compat_constraint('assignments','reelencer_assignments_worker_fkey','foreign key(worker_id) references public.profiles(id)');
select pg_temp.reelencer_compat_constraint('assignments','reelencer_assignments_account_fkey','foreign key(account_id) references public.accounts(id)');
select pg_temp.reelencer_compat_constraint('assignments','reelencer_assignments_worker_account_key','unique(worker_id,account_id)');
select pg_temp.reelencer_compat_constraint('worker_account_assignments','reelencer_worker_account_assignments_worker_fkey','foreign key(worker_id) references public.profiles(id)');
select pg_temp.reelencer_compat_constraint('worker_accounts','reelencer_worker_accounts_worker_fkey','foreign key(worker_id) references public.profiles(id)');
select pg_temp.reelencer_compat_constraint('worker_accounts','reelencer_worker_accounts_account_fkey','foreign key(account_id) references public.accounts(id)');
select pg_temp.reelencer_compat_constraint('work_items','reelencer_work_items_worker_fkey','foreign key(worker_id) references public.profiles(id)');
select pg_temp.reelencer_compat_constraint('work_item_audit','reelencer_work_item_audit_actor_fkey','foreign key(actor_id) references auth.users(id)');
select pg_temp.reelencer_compat_constraint('gig_applications','reelencer_gig_applications_worker_key','unique(gig_id,worker_code)');
select pg_temp.reelencer_compat_constraint('gig_assignments','reelencer_gig_assignments_worker_key','unique(gig_id,worker_code)');
select pg_temp.reelencer_compat_constraint('gig_assignments','reelencer_gig_assignments_email_key','unique(assigned_email)');
select pg_temp.reelencer_compat_constraint('gig_account_credentials','reelencer_gig_credentials_email_key','unique(assignment_id,email)');
select pg_temp.reelencer_compat_constraint('gig_inbox','reelencer_gig_inbox_message_key','unique(assignment_id,message_id)');
select pg_temp.reelencer_compat_constraint('worker_kyc','reelencer_worker_kyc_profile_fkey','foreign key(user_id) references public.profiles(id)');
-- Audit events are historical evidence, not active ownership. Existing evidence
-- must survive a former KYC/Auth parent's deletion. NOT VALID skips only the
-- initial historic scan; PostgreSQL still rejects new orphan inserts or changed
-- references. Other ownership constraints remain fully validated above/below.
do $$
declare orphan_count bigint;
begin
  if to_regclass('public.worker_kyc_events') is null then return; end if;
  select count(*) into orphan_count from public.worker_kyc_events event
    where event.kyc_id is not null and not exists(select 1 from public.worker_kyc kyc where kyc.id=event.kyc_id);
  if orphan_count>0 then
    raise notice 'Preserving % historical KYC audit events without their former KYC parent; future references remain enforced',orphan_count;
    perform pg_temp.reelencer_compat_constraint('worker_kyc_events','reelencer_worker_kyc_events_kyc_fkey',
      'foreign key(kyc_id) references public.worker_kyc(id) not valid');
  else
    perform pg_temp.reelencer_compat_constraint('worker_kyc_events','reelencer_worker_kyc_events_kyc_fkey',
      'foreign key(kyc_id) references public.worker_kyc(id)');
  end if;
  select count(*) into orphan_count from public.worker_kyc_events event
    where event.actor_id is not null and not exists(select 1 from auth.users actor where actor.id=event.actor_id);
  if orphan_count>0 then
    raise notice 'Preserving % historical KYC audit events without their former Auth actor; future references remain enforced',orphan_count;
    perform pg_temp.reelencer_compat_constraint('worker_kyc_events','reelencer_worker_kyc_events_actor_fkey',
      'foreign key(actor_id) references auth.users(id) not valid');
  else
    perform pg_temp.reelencer_compat_constraint('worker_kyc_events','reelencer_worker_kyc_events_actor_fkey',
      'foreign key(actor_id) references auth.users(id)');
  end if;
end $$;
select pg_temp.reelencer_compat_constraint('upi_configs','reelencer_upi_configs_profile_fkey','foreign key(worker_id) references public.profiles(id)');
select pg_temp.reelencer_compat_constraint('payout_batches','reelencer_payout_batches_profile_fkey','foreign key(worker_id) references public.profiles(id)');
select pg_temp.reelencer_compat_constraint('payout_items','reelencer_payout_items_profile_fkey','foreign key(worker_id) references public.profiles(id)');
select pg_temp.reelencer_compat_constraint('payout_items','reelencer_payout_items_batch_work_key','unique(batch_id,work_item_id)');
select pg_temp.reelencer_compat_constraint('profiles','reelencer_profiles_role_check','check(role in (''Admin'',''Worker''))');
select pg_temp.reelencer_compat_constraint('work_items','reelencer_work_items_status_check','check(status in (''Open'',''In progress'',''Submitted'',''Needs fix'',''Approved'',''Hard rejected''))');
select pg_temp.reelencer_compat_constraint('work_items','reelencer_work_items_reward_check','check(reward_inr>=0)');
select pg_temp.reelencer_compat_constraint('work_items','reelencer_work_items_timing_check','check(est_minutes>0 and sla_minutes>0)');
select pg_temp.reelencer_compat_constraint('worker_kyc','reelencer_worker_kyc_status_check','check(status in (''pending'',''approved'',''rejected''))');
select pg_temp.reelencer_compat_constraint('payout_batches','reelencer_payout_batches_status_check','check(status in (''Draft'',''Processing'',''Paid'',''Failed''))');
select pg_temp.reelencer_compat_constraint('payout_items','reelencer_payout_items_status_check','check(status in (''Included'',''Paid'',''Failed''))');
select pg_temp.reelencer_compat_constraint('payout_items','reelencer_payout_items_amount_check','check(amount_inr>0)');
