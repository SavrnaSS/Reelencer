-- Reels count from the day their account was linked (India time). A reel that went live before that day is never
-- tracked or paid: it can't be approved, pending ones are closed with a note, and view payout quotes and claims
-- leave its views out. lib/reelTracking.ts applies the same rule in the app.

create or replace function public.reel_tracking_start(p_linked_at timestamptz) returns timestamptz
language sql stable set search_path='' as $$
 select (date_trunc('day', p_linked_at at time zone 'Asia/Kolkata')) at time zone 'Asia/Kolkata'
$$;

create or replace function public.guard_reel_tracking_window() returns trigger
language plpgsql set search_path='' as $$
declare linked timestamptz;
begin
 if new.status<>'approved' or new.posted_at is null then return new; end if;
 -- Already-approved reels keep their state; only a new approval or a changed date is checked.
 if tg_op='UPDATE' and old.status='approved' and old.posted_at is not distinct from new.posted_at then return new; end if;
 select linked_at into linked from public.linked_social_accounts where id=new.account_id;
 if linked is not null and new.posted_at<public.reel_tracking_start(linked) then raise exception 'reel_before_link'; end if;
 return new;
end; $$;

drop trigger if exists social_account_posts_tracking_window on public.social_account_posts;
create trigger social_account_posts_tracking_window before insert or update of status, posted_at on public.social_account_posts
 for each row execute function public.guard_reel_tracking_window();

-- Reels waiting for review that went live before linking can never be approved: close them with a note.
update public.social_account_posts p
 set status='rejected', review_note='Posted before this account was linked. Only reels posted from the day it was linked count.', reviewed_at=now(), updated_at=now()
 from public.linked_social_accounts a
 where a.id=p.account_id and p.status='submitted' and p.posted_at<public.reel_tracking_start(a.linked_at);

create index if not exists social_account_posts_window on public.social_account_posts(account_id, status, posted_at);

create or replace function public.view_payout_quote(p_actor uuid,p_account uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a public.linked_social_accounts%rowtype; g public.gigs%rowtype; code text; rate numeric; amount numeric; v bigint; missing integer; pending uuid;
begin
 select * into a from public.linked_social_accounts where id=p_account;
 if not found then raise exception 'not_found'; end if;
 select worker_code into code from public.profiles where id=p_actor and active;
 if not public.app_is_admin(p_actor) and (code is null or a.worker_code not in (code,p_actor::text)) then raise exception 'not_found'; end if;
 select * into g from public.gigs where id=a.gig_id;
 if lower(btrim(coalesce(g.payout_type,'')))<>'per 1k views' then raise exception 'invalid_view_rate'; end if;
 if btrim(g.payout) !~ '^(₹|INR)?[[:space:]]*([0-9]+|[0-9]{1,3}(,[0-9]{2,3})+)([.][0-9]{1,2})?$' then raise exception 'invalid_view_rate'; end if;
 rate:=replace(regexp_replace(g.payout,'[^0-9.,]','','g'),',','')::numeric;
 if rate<=0 or rate>9999999999.99 then raise exception 'invalid_view_rate'; end if;
 select id into pending from public.view_payout_claims where account_id=a.id and status='Pending';
 select count(*) into missing from public.social_account_posts where account_id=a.id and status='approved' and views is null
  and (posted_at is null or posted_at>=public.reel_tracking_start(a.linked_at));
 with eligible as (
  select p.views,coalesce((select max(i.to_views) from public.view_payout_claim_items i join public.view_payout_claims c on c.id=i.claim_id where i.post_id=p.id and c.status in ('Pending','Approved','Hard rejected')),0) as consumed
  from public.social_account_posts p where p.account_id=a.id and p.status='approved' and p.views is not null
  and (p.posted_at is null or p.posted_at>=public.reel_tracking_start(a.linked_at))
 ) select coalesce(sum(greatest(views-consumed,0)),0),coalesce(sum(case when views>consumed then round(views*rate/1000,2)-round(consumed*rate/1000,2) else 0 end),0) into v,amount from eligible;
 return jsonb_build_object('accountId',a.id,'rateINR',rate,'claimableViews',v,'claimableINR',amount,'missingCounts',missing,'pendingClaimId',pending,'active',a.status='active');
end; $$;

create or replace function public.submit_view_payout_claim(p_actor uuid,p_account uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a public.linked_social_accounts%rowtype; q jsonb; c public.view_payout_claims%rowtype; evidence jsonb; amount numeric; total_views bigint;
begin
 perform 1 from public.profiles where id=p_actor and active for update;
 if not found then raise exception 'forbidden'; end if;
 select * into a from public.linked_social_accounts where id=p_account for update;
 if not exists(select 1 from public.profiles where id=p_actor and active and a.worker_code in (worker_code,p_actor::text)) then raise exception 'not_found'; end if;
 q:=public.view_payout_quote(p_actor,p_account);
 if a.status<>'active' then raise exception 'claim_account_inactive'; end if;
 if q->>'pendingClaimId' is not null then return jsonb_build_object('id',q->>'pendingClaimId','idempotent',true); end if;
 -- Lock the evidence while the claim snapshots are taken.
 perform 1 from public.social_account_posts where account_id=a.id order by id for update;
 q:=public.view_payout_quote(p_actor,p_account);
 if (q->>'claimableINR')::numeric<=0 then raise exception 'no_claimable_views'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('post_id',p.id,'url',p.url,'from_views',x.consumed,'to_views',p.views,
 'amount_inr',round(p.views*(q->>'rateINR')::numeric/1000,2)-round(x.consumed*(q->>'rateINR')::numeric/1000,2),'source',coalesce(p.views_source,p.source),'captured_at',coalesce(p.views_captured_at,p.updated_at))),'[]'::jsonb),
 coalesce(sum(round(p.views*(q->>'rateINR')::numeric/1000,2)-round(x.consumed*(q->>'rateINR')::numeric/1000,2)),0),coalesce(sum(p.views-x.consumed),0)
 into evidence,amount,total_views
 from public.social_account_posts p cross join lateral (
 select coalesce(max(i.to_views),0) as consumed from public.view_payout_claim_items i join public.view_payout_claims previous on previous.id=i.claim_id
 where i.post_id=p.id and previous.status in ('Pending','Approved','Hard rejected')
 ) x where p.account_id=a.id and p.status='approved' and p.views>x.consumed
 and (p.posted_at is null or p.posted_at>=public.reel_tracking_start(a.linked_at));
 if amount<=0 then raise exception 'no_claimable_views'; end if;
 insert into public.view_payout_claims(account_id,worker_id,rate_inr,amount_inr,views)
 values(a.id,p_actor,(q->>'rateINR')::numeric,amount,total_views) returning * into c;
 insert into public.view_payout_claim_items(claim_id,post_id,url,from_views,to_views,amount_inr,source,captured_at)
 select c.id,e.post_id,e.url,e.from_views,e.to_views,e.amount_inr,e.source,e.captured_at from jsonb_to_recordset(evidence)
 as e(post_id uuid,url text,from_views bigint,to_views bigint,amount_inr numeric,source text,captured_at timestamptz);
 insert into public.audit_events(actor_id,action,resource_id,details) values(p_actor,'view_claim_submitted',c.id::text,q);
 return to_jsonb(c);
end; $$;

revoke all on function public.reel_tracking_start(timestamptz) from public,anon,authenticated;
grant execute on function public.reel_tracking_start(timestamptz) to service_role;
revoke all on function public.guard_reel_tracking_window() from public,anon,authenticated;

notify pgrst, 'reload schema';
