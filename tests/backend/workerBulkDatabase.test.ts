import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { realtimeTestSchema } from "./helpers/realtime";

const db=new PGlite();
const admin="33333333-3333-4333-8333-333333333333";
const a="11111111-1111-4111-8111-111111111111";
const b="22222222-2222-4222-8222-222222222222";
const c="44444444-4444-4444-8444-444444444444";
type Item={workerId:string;userId:string|null;status:string;eligible:boolean;skipReason?:string;ip?:string;expectedUpdatedAt?:string;expectedProfileActive?:boolean;expectedWorkerActive?:boolean};
type Result={operationId:string;action:string;items:{workerId:string;userId:string;status:string;message:string}[];succeeded:number;skipped:number;failed:number};
async function value<T>(sql:string,params:unknown[]=[]):Promise<T>{return (await db.query<{value:T}>(sql,params)).rows[0]?.value;}
async function preview(ids:string[],action:string,ip:string|null="1.1.1.1"){return value<Item[]>("select public.preview_workers_bulk($1,$2,$3,$4) as value",[admin,ids,action,ip]);}
async function apply(items:Item[],action:string,operation=randomUUID(),hash="a".repeat(64),expiry=new Date(Date.now()+600_000).toISOString()){
  return value<Result>("select public.moderate_workers_bulk($1,$2,$3,$4,$5,$6,$7,$8) as value",[admin,action,"Documented policy review for selected users",JSON.stringify(items),operation,hash,expiry,"1.1.1.1"]);
}
async function restore(id:string){await db.query("select public.moderate_worker($1,$2,'restore','Access restored for next test fixture')",[admin,id]);}

before(async()=>{
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
    create schema auth;create schema storage;
    create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}');
    create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
    alter table storage.objects enable row level security;
    grant usage on schema public,auth to anon,authenticated,service_role;`);
  await db.exec(realtimeTestSchema);
  for(const file of (await readdir("supabase/migrations")).filter(name=>name.endsWith(".sql")).sort()){
    if(file==="202610040007_admin_identity.sql")await db.exec("alter default privileges in schema public grant all on tables to anon,authenticated,service_role");
    try{await db.exec(await readFile("supabase/migrations/"+file,"utf8"));}
    catch(error){throw new Error("Migration failed: "+file,{cause:error});}
  }
  for(const [id,email] of [[admin,"operator@example.test"],[a,"bulk-a@example.test"],[b,"bulk-b@example.test"],[c,"bulk-c@example.test"]]){
    await db.query("insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())",[id,email]);
    await db.query("select public.bootstrap_worker($1)",[id]);
  }
  await db.query("select public.configure_admin_owner($1,'operator@example.test','Bulk Admin',null)",[admin]);
});
after(async()=>{await db.close();});

test("bulk preview canonicalizes aliases, skips protected or absent users and enforces the selection limit",async()=>{
  const code=await value<string>("select worker_code as value from public.profiles where id=$1",[a]);
  await db.query("update public.workers set id='LEGACY-BULK-A' where user_id=$1",[a]);
  const items=await preview([a,code,"LEGACY-BULK-A",admin,"MISSING-USER"],"suspend");
  assert.equal(items.length,3);
  assert.equal(items.find(item=>item.userId===a)?.workerId,code);
  assert.equal(items.find(item=>item.userId===a)?.eligible,true);
  assert.match(items.find(item=>item.userId===admin)?.skipReason??"",/protected/);
  assert.equal(items.find(item=>item.workerId==="MISSING-USER")?.eligible,false);
  const peerCode=await value<string>("select worker_code as value from public.profiles where id=$1",[b]);
  await db.query("update public.profiles set worker_code='LEGACY-BULK-A' where id=$1",[b]);
  const ambiguous=await preview(["LEGACY-BULK-A"],"suspend");
  assert.equal(ambiguous[0].eligible,false);assert.match(ambiguous[0].skipReason??"",/multiple users/);
  await db.query("update public.profiles set worker_code=$2 where id=$1",[b,peerCode]);
  await assert.rejects(preview(Array.from({length:101},(_,index)=>"WORKER-"+index),"suspend"),/invalid_bulk_selection/);
  await assert.rejects(value("select public.preview_workers_bulk($1,$2,'suspend',null) as value",[a,[b]]),/forbidden/);
});

test("bulk changes are durable, idempotent, actor-protected and stale previews cannot overwrite newer decisions",async()=>{
  const items=await preview([a,b,admin,"MISSING-USER"],"suspend");
  await db.query("select public.moderate_worker($1,$2,'delete','Account archived by another review',$3)",[admin,b,await value<string>("select worker_code as value from public.profiles where id=$1",[b])]);
  const operation=randomUUID();
  const result=await apply(items,"suspend",operation);
  assert.equal(result.succeeded,1);
  assert.equal(result.skipped,3);
  assert.match(result.items.find(item=>item.userId===b)?.message??"",/changed after/);
  const events=await value<number>("select count(*)::int as value from public.worker_moderation_events where user_id=$1",[a]);
  assert.deepEqual(await apply(items,"suspend",operation,"a".repeat(64),"2000-01-01T00:00:00Z"),result,"an expired retry recovers the exact committed result");
  assert.equal(await value<number>("select count(*)::int as value from public.worker_moderation_events where user_id=$1",[a]),events);
  await assert.rejects(apply(items,"suspend",operation,"b".repeat(64)),/bulk_idempotency_conflict/);
  const replay=await apply(items,"suspend");
  assert.equal(replay.succeeded,0);
  assert.equal(await value<number>("select count(*)::int as value from public.worker_moderation_events where user_id=$1",[a]),events);
  assert.deepEqual(await value<Result>("select result as value from public.worker_bulk_operations where id=$1",[operation]),result);
  await assert.rejects(apply(await preview([c],"suspend"),"suspend",randomUUID(),"c".repeat(64),"2000-01-01T00:00:00Z"),/bulk_preview_expired/);
  assert.equal(await value<boolean>("select active as value from public.profiles where id=$1",[c]),true);
});

test("per-user savepoints isolate a failed target and never expose raw database errors",async()=>{
  await restore(a);await restore(b);
  const items=await preview([a,b],"suspend");
  await db.exec(`create function public.test_bulk_failure() returns trigger language plpgsql as $$begin
    if NEW.id='${b}' and not NEW.active then raise exception using errcode='23514',message='internal_database_secret';end if;return NEW;end;$$;
    create trigger test_bulk_failure before update on public.profiles for each row execute function public.test_bulk_failure();`);
  try{
    const result=await apply(items,"suspend");
    assert.equal(result.succeeded,1);assert.equal(result.failed,1);
    assert.equal(JSON.stringify(result).includes("internal_database_secret"),false);
    assert.equal(await value<boolean>("select active as value from public.profiles where id=$1",[a]),false);
    assert.equal(await value<boolean>("select active as value from public.profiles where id=$1",[b]),true);
    assert.equal(await value<string>("select status as value from public.worker_moderation where user_id=$1",[b]),"active");
  }finally{await db.exec("drop trigger test_bulk_failure on public.profiles;drop function public.test_bulk_failure()");}
});

test("bulk IP preview chooses a safe captured address and unblocking invalidates a reviewed plan",async()=>{
  await restore(a);await restore(b);await restore(c);
  await db.query("select public.record_worker_access($1,'8.8.8.8')",[a]);
  await db.query("select public.record_worker_access($1,'9.9.9.9')",[a]);
  await db.query("select public.record_worker_access($1,'1.1.1.1')",[a]);
  await db.query("select public.record_worker_access($1,'9.9.9.9')",[admin]);
  const items=await preview([a,b],"suspend_ip");
  assert.equal(items.find(item=>item.userId===a)?.ip,"8.8.8.8");
  assert.equal(items.find(item=>item.userId===b)?.eligible,false);
  const result=await apply(items,"suspend_ip");
  assert.equal(result.succeeded,1);assert.equal(result.skipped,1);
  const restoration=await preview([a],"restore");
  await db.query("select public.moderate_worker($1,$2,'unblock_ip','Shared network review accepted',null,'8.8.8.8')",[admin,a]);
  const stale=await apply(restoration,"restore");
  assert.equal(stale.succeeded,0);assert.match(stale.items[0].message,/changed after/);
  assert.equal((await preview([a],"suspend_ip",null))[0].eligible,false);
});

test("active-flag changes are stale and restoration reconciles inconsistent legacy flags",async()=>{
  await restore(b);await restore(c);
  const items=await preview([b,c],"suspend");
  await db.query("update public.workers set active=false where user_id=$1",[b]);
  await db.query("update public.profiles set active=false where id=$1",[c]);
  const result=await apply(items,"suspend");
  assert.equal(result.succeeded,0);assert.equal(result.skipped,2);
  const restoration=await preview([b,c],"restore");
  assert.ok(restoration.every(item=>item.status==="suspended"&&item.eligible));
  const restored=await apply(restoration,"restore");
  assert.equal(restored.succeeded,2);
  assert.equal(await value<boolean>("select active as value from public.workers where user_id=$1",[b]),true);
  assert.equal(await value<boolean>("select active as value from public.profiles where id=$1",[c]),true);
});

test("operation result and per-user mutations share one transaction and browser roles cannot access batches",async()=>{
  await restore(c);
  const items=await preview([c],"delete");
  const operation=randomUUID();
  await db.exec("begin");
  try{assert.equal((await apply(items,"delete",operation)).succeeded,1);}finally{await db.exec("rollback");}
  assert.equal(await value<number>("select count(*)::int as value from public.worker_bulk_operations where id=$1",[operation]),0);
  assert.equal(await value<boolean>("select active as value from public.profiles where id=$1",[c]),true);
  for(const role of ["anon","authenticated"]){
    assert.equal(await value<boolean>("select has_table_privilege($1,'public.worker_bulk_operations','select') as value",[role]),false);
    assert.equal(await value<boolean>("select has_function_privilege($1,'public.moderate_workers_bulk(uuid,text,text,jsonb,uuid,text,timestamptz,inet)','execute') as value",[role]),false);
  }
  assert.equal(await value<boolean>("select has_table_privilege('service_role','public.worker_bulk_operations','select') as value"),true);
  assert.equal(await value<boolean>("select has_table_privilege('service_role','public.worker_bulk_operations','update') as value"),false);
});
