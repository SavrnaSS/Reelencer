import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
const require=createRequire(`${process.cwd()}/package.json`);
const {Client}=require('pg');
if(!process.env.DATABASE_URL)throw new Error('DATABASE_URL is not configured');
const url=new URL(process.env.DATABASE_URL);
const local=['localhost','127.0.0.1','[::1]'].includes(url.hostname);
const caFile=process.env.DATABASE_SSL_CA_FILE||url.searchParams.get('sslrootcert');
const ca=process.env.DATABASE_SSL_CA||(caFile?await readFile(caFile,'utf8'):undefined);
const certFile=url.searchParams.get('sslcert'),keyFile=url.searchParams.get('sslkey');
const cert=certFile?await readFile(certFile,'utf8'):undefined,key=keyFile?await readFile(keyFile,'utf8'):undefined;
for(const option of ['ssl','sslmode','sslrootcert','sslcert','sslkey'])url.searchParams.delete(option);
const client=new Client({connectionString:url.toString(),ssl:local?false:{rejectUnauthorized:true,...(ca?{ca}:{}),...(cert?{cert}:{}),...(key?{key}:{})},connectionTimeoutMillis:10000,statement_timeout:120000});

// Reconcile already-approved view earnings without minting estimates or replaying consumed claim ranges.
// Default is a read-only preview. --apply changes the wallet ledger atomically; --actor UUID selects an admin.
const args=process.argv.slice(2);
if(args.some((arg,index)=>arg!=='--apply' && arg!=='--actor' && args[index-1]!=='--actor')) throw new Error('Use --apply and optional --actor UUID only.');
const apply=args.includes('--apply');
const actorIndex=args.indexOf('--actor');
let actor=actorIndex>=0?args[actorIndex+1]:undefined;
if(actorIndex>=0 && !/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(actor??'')) throw new Error('--actor requires an administrator UUID.');

const CANDIDATE_SQL="with eligible as (\n   select p.id,p.views,p.status,p.posted_at,a.linked_at,g.payout_type,\n     case when btrim(g.payout) ~ '^(₹|INR)?[[:space:]]*([0-9]+|[0-9]{1,3}(,[0-9]{2,3})+)([.][0-9]{1,2})?$'\n       then replace(regexp_replace(g.payout,'[^0-9.,]','','g'),',','')::numeric end rate,\n     coalesce((select max(i.to_views) from public.view_payout_claim_items i join public.view_payout_claims c on c.id=i.claim_id where i.post_id=p.id and c.status in ('Pending','Approved','Hard rejected')),0) consumed,\n     exists(select 1 from public.view_payout_claim_items i join public.view_payout_claims c on c.id=i.claim_id where i.post_id=p.id and c.status='Pending') reserved\n   from public.social_account_posts p join public.linked_social_accounts a on a.id=p.account_id join public.gigs g on g.id=a.gig_id\n   where p.status='approved' and nullif(to_jsonb(p)->>'removed_at','') is null and a.status in ('active','paused')\n   and exists(select 1 from public.profiles w where w.active and w.role='Worker' and lower(a.worker_code) in(lower(w.worker_code),lower(w.id::text),lower(w.email)))\n ), payable as (\n   select *,case when views>consumed and rate>0 and rate<=9999999999.99 and lower(btrim(payout_type))='per 1k views' and posted_at is not null and posted_at>=date_trunc('day',linked_at at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata'\n      then round(views*rate/1000,2)-round(consumed*rate/1000,2) else 0 end amount\n   from eligible\n ) select id,amount from payable where amount>0 order by id";

try {
  await client.connect();
  await client.query(apply?'begin':'begin read only');
  const candidates=(await client.query(CANDIDATE_SQL)).rows;
  const previewINR=candidates.reduce((sum,row)=>sum+Math.round(Number(row.amount)*100),0)/100;
  if(!apply) {
    console.log(JSON.stringify({previewOnly:true,eligibleReels:candidates.length,eligibleINR:previewINR,notes:'Only uncovered approved view earnings. Pending, approved and hard-rejected claim ranges remain consumed; existing payments are preserved.'},null,2));
    await client.query('rollback');
  } else {
    if(!actor) {
      const admins=(await client.query('select id from public.profiles where public.app_is_admin(id) order by id')).rows;
      if(admins.length!==1) throw new Error('Select the administrator with --actor UUID.');
      actor=admins[0].id;
    }
    if((await client.query('select public.app_is_admin($1::uuid) as allowed',[actor])).rows[0]?.allowed!==true) throw new Error('Administrator permission is required.');
    let creditedReels=0,creditedPaise=0;
    for(const row of candidates) {
      const result=(await client.query('select public.credit_approved_social_post($1::uuid,$2::uuid) as result',[actor,row.id])).rows[0].result;
      if(result.credited) {creditedReels++; creditedPaise+=Math.round(Number(result.amountINR)*100);}
    }
    await client.query("insert into public.audit_events(actor_id,action,resource_id,details) values($1,'approved_reel_wallet_reconciliation','approved-reels',$2::jsonb)",[actor,JSON.stringify({creditedReels,creditedINR:creditedPaise/100,source:'operator_reconciliation',preservedExistingClaims:true})]);
    await client.query('commit');
    console.log(JSON.stringify({applied:true,creditedReels,creditedINR:creditedPaise/100},null,2));
  }
} catch(error) {
  await client.query('rollback').catch(()=>{});
  console.error(JSON.stringify({reconciliationFailed:true,code:error.code??error.name,message:error.code?'Database transaction failed; no reconciliation credits were committed.':error.message}));
  process.exitCode=1;
} finally {await client.end().catch(()=>{});}
