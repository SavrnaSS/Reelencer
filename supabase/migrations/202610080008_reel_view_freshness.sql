-- View freshness belongs to the measurement, not to likes, comments or review changes.
alter table public.social_account_posts
 add column if not exists views_captured_at timestamptz,
 add column if not exists views_source text check (views_source in ('manual','profile','api','screenshot'));
update public.social_account_posts set views_captured_at=updated_at,views_source=source where views is not null and views_captured_at is null;

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
 ) x where p.account_id=a.id and p.status='approved' and p.views>x.consumed;
 if amount<=0 then raise exception 'no_claimable_views'; end if;
 insert into public.view_payout_claims(account_id,worker_id,rate_inr,amount_inr,views)
 values(a.id,p_actor,(q->>'rateINR')::numeric,amount,total_views) returning * into c;
 insert into public.view_payout_claim_items(claim_id,post_id,url,from_views,to_views,amount_inr,source,captured_at)
 select c.id,e.post_id,e.url,e.from_views,e.to_views,e.amount_inr,e.source,e.captured_at from jsonb_to_recordset(evidence)
 as e(post_id uuid,url text,from_views bigint,to_views bigint,amount_inr numeric,source text,captured_at timestamptz);
 insert into public.audit_events(actor_id,action,resource_id,details) values(p_actor,'view_claim_submitted',c.id::text,q);
 return to_jsonb(c);
end; $$;

notify pgrst, 'reload schema';
