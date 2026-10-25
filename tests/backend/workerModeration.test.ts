import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { moderateWorker, getWorkerModeration, validateWorkerModerationInput } from "../../lib/api/workerModeration";
import { ApiError } from "../../lib/api/errors";
import { NextRequest } from "next/server";

const worker="11111111-1111-4111-8111-111111111111";
const admin="33333333-3333-4333-8333-333333333333";
const originalFetch=globalThis.fetch;
const requests:{path:string;body:Record<string,unknown>|null}[]=[];
let state="active";
let failure:string|null=null;
let activeOverride:boolean|null=null;
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json"}});

before(()=>{
  process.env.NEXT_PUBLIC_SUPABASE_URL="https://moderation.example.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY="test-service-key";
  process.env.ADMIN_EMAIL="operator@example.test";
  globalThis.fetch=async(input,init)=>{
    const url=new URL(input instanceof Request?input.url:String(input));
    assert.equal(url.origin,"https://moderation.example.test","Tests must not call a real service");
    const body=typeof init?.body==="string"?JSON.parse(init.body):null;
    requests.push({path:url.pathname,body});
    if(url.pathname==="/auth/v1/user")return json({id:admin,email:"operator@example.test",email_confirmed_at:"2026-01-01T00:00:00Z",is_anonymous:false});
    if(url.pathname==="/rest/v1/rpc/app_is_admin"||url.pathname==="/rest/v1/rpc/consume_api_rate_limit")return json(true);
    if(url.pathname==="/rest/v1/profiles"&&url.searchParams.get("id")==="eq."+admin)return json([{id:admin,role:"Admin",worker_code:"ADMIN",active:true}]);
    if(url.pathname==="/rest/v1/workers"&&url.searchParams.get("user_id")==="eq."+admin)return json([]);
    if(url.pathname==="/rest/v1/profiles")return json([{id:worker,role:"Worker",worker_code:"WKR-TEST",active:activeOverride??state==="active"}]);
    if(url.pathname==="/rest/v1/workers")return json([{id:"WKR-TEST",user_id:worker,active:activeOverride??state==="active"}]);
    if(url.pathname==="/rest/v1/worker_moderation")return json([{status:state,reason:state==="active"?null:"Policy violation",suspended_at:state==="suspended"?"2026-10-21T10:00:00Z":null,deleted_at:state==="deleted"?"2026-10-21T10:00:00Z":null}]);
    if(url.pathname==="/rest/v1/worker_access_ips")return json([{ip:"8.8.8.8",last_seen_at:"2026-10-21T10:00:00Z"}]);
    if(url.pathname==="/rest/v1/worker_deletion_jobs")return json(state==="deleted"?[{status:"scheduled",next_attempt_at:"2026-10-28T10:00:00Z"}]:[]);
    if(url.pathname==="/rest/v1/worker_ip_blocks")return json(state==="suspended"?[{ip:"8.8.8.8"}]:[]);
    if(url.pathname==="/rest/v1/worker_moderation_events")return json([{id:"event-1",action:"suspend",reason:"Policy violation",actor_label:"Administrator",created_at:"2026-10-21T10:00:00Z"}]);
    if(url.pathname==="/rest/v1/rpc/moderate_worker"){
      if(failure)return json({code:"P0001",message:failure},400);
      state=body.p_action==="delete"?"deleted":body.p_action==="restore"?"active":"suspended";
      return json({status:state,changed:true});
    }
    throw new Error("Unexpected test backend route: "+url.pathname);
  };
});
after(()=>{globalThis.fetch=originalFetch;});

test("moderation input requires an explicit action, reason, exact-host public IP and delete confirmation",()=>{
  for(const input of [null,[],{}, {action:"disable",reason:"Policy violation"},{action:"suspend",reason:"bad"},{action:"suspend",reason:"x".repeat(1001)},{action:"delete",reason:"Policy violation"},{action:"suspend_ip",reason:"Policy violation",ip:"10.0.0.1"},{action:"unblock_ip",reason:"Appeal accepted",ip:"8.8.8.0/24"}]){
    assert.throws(()=>validateWorkerModerationInput(input),ApiError);
  }
  assert.deepEqual(validateWorkerModerationInput({action:"suspend",reason:"  Repeated policy violations  "}),{action:"suspend",reason:"Repeated policy violations",confirmation:undefined});
  assert.equal(validateWorkerModerationInput({action:"suspend_ip",reason:"Repeated policy violations",ip:"2606:4700:4700:0:0:0:0:1111"}).ip,"2606:4700:4700::1111");
});

test("moderation summary includes public connection evidence and readable audit history",async()=>{
  state="active";
  const result=await getWorkerModeration("WKR-TEST");
  assert.equal(result.status,"active");
  assert.equal(result.lastSeenAt,"2026-10-21T10:00:00Z");
  assert.deepEqual(result.knownIps,[{ip:"8.8.8.8",lastSeenAt:"2026-10-21T10:00:00Z",blocked:false}]);
  assert.equal(result.history[0].actorLabel,"Administrator");
  activeOverride=false;
  try{assert.equal((await getWorkerModeration("WKR-TEST")).status,"suspended","inactive legacy flags remain visible when moderation state says active");}
  finally{activeOverride=null;}
});

test("mutations use the canonical user and atomic audited RPC, retaining the Auth identity",async()=>{
  state="active";failure=null;requests.length=0;
  const result=await moderateWorker({actorId:admin,workerId:"WKR-TEST",input:{action:"suspend_ip",reason:"Confirmed repeated abuse",ip:"8.8.8.8"},actorIp:"1.1.1.1"});
  assert.equal(result.status,"suspended");
  assert.deepEqual(requests.find(request=>request.path==="/rest/v1/rpc/moderate_worker")?.body,{p_actor:admin,p_worker:worker,p_action:"suspend_ip",p_reason:"Confirmed repeated abuse",p_confirmation:null,p_ip:"8.8.8.8",p_actor_ip:"1.1.1.1"});
  assert.equal(requests.some(request=>request.path.startsWith("/auth/")),false);
  requests.length=0;
  await assert.rejects(moderateWorker({actorId:admin,workerId:worker,input:{action:"delete",reason:"Completed policy review",confirmation:"WRONG-ID"},actorIp:null}),/exactly match/);
  assert.equal(requests.some(request=>request.path==="/rest/v1/rpc/moderate_worker"),false);
  const deleted=await moderateWorker({actorId:admin,workerId:worker,input:{action:"delete",reason:"Completed policy review",confirmation:"WKR-TEST"},actorIp:null});
  assert.equal(deleted.status,"deleted");
  const restored=await moderateWorker({actorId:admin,workerId:worker,input:{action:"restore",reason:"Appeal accepted after investigation"},actorIp:null});
  assert.equal(restored.status,"active");
});

test("protected addresses and unobserved IP transaction errors are safe and actionable",async()=>{
  for(const [message,status] of [["admin_ip_protected",409],["worker_ip_not_observed",409],["actor_ip_required",409],["moderation_reason_required",400]] as const){
    failure=message;
    await assert.rejects(moderateWorker({actorId:admin,workerId:worker,input:{action:"suspend_ip",reason:"Documented policy violation",ip:"8.8.8.8"},actorIp:"1.1.1.1"}),(error:unknown)=>error instanceof ApiError&&error.status===status&&error.code===message);
  }
  failure=null;
});

test("administrators retain account controls when the configured ingress address is missing",async()=>{
  const previous=process.env.TRUSTED_CLIENT_IP_HEADER;
  process.env.TRUSTED_CLIENT_IP_HEADER="cf-connecting-ip";
  state="active";failure=null;
  const context={params:Promise.resolve({id:"WKR-TEST"})};
  const headers={authorization:"Bearer admin","content-type":"application/json"};
  try {
    const {GET,POST}=await import("../../app/api/admin/workers/[id]/moderation/route");
    const read=await GET(new NextRequest("https://app.example.test/api/admin/workers/WKR-TEST/moderation",{headers}),context);
    assert.equal(read.status,200);
    const data=await read.json();
    assert.equal(data.moderation.canBlockIps,false);
    assert.equal(data.moderation.ipTrackingEnabled,true);
    const suspended=await POST(new NextRequest("https://app.example.test/api/admin/workers/WKR-TEST/moderation",{method:"POST",headers,body:JSON.stringify({action:"suspend",reason:"Confirmed repeated policy violation"})}),context);
    assert.equal(suspended.status,200);
    assert.equal((await suspended.json()).moderation.status,"suspended");
    const legacy=await import("../../app/api/admin/delete-worker/route");
    const removed=await legacy.POST(new NextRequest("https://app.example.test/api/admin/delete-worker",{method:"POST",headers,body:JSON.stringify({workerId:"WKR-TEST",reason:"Completed archival review",confirmation:"WKR-TEST"})}),context);
    assert.equal(removed.status,200);
    assert.equal((await removed.json()).moderation.status,"deleted");
  } finally {
    if(previous===undefined)delete process.env.TRUSTED_CLIENT_IP_HEADER;
    else process.env.TRUSTED_CLIENT_IP_HEADER=previous;
  }
});
