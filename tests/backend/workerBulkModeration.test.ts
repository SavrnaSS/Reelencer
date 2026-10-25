import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { previewWorkerBulk, applyWorkerBulk, getWorkerBulkResult } from "../../lib/api/workerBulkModeration";
import { ApiError } from "../../lib/api/errors";
import type { BulkAction, BulkResult } from "../../lib/workerBulkTypes";

const admin="33333333-3333-4333-8333-333333333333";
const worker="11111111-1111-4111-8111-111111111111";
const originalFetch=globalThis.fetch;
const requests:{path:string;body:Record<string,unknown>|null}[]=[];
const saved=new Map<string,{actor:string;hash:string;result:BulkResult}>();
let expired=false;
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json"}});
const fixture=()=>[{workerId:"WKR-TEST",userId:worker,name:"Worker",email:"worker@example.test",status:"active",eligible:true,expectedUpdatedAt:null,expectedProfileActive:true,expectedWorkerActive:true},
  {workerId:"WKR-SUSPENDED",userId:"22222222-2222-4222-8222-222222222222",name:"Suspended",email:"suspended@example.test",status:"suspended",eligible:false,skipReason:"Access is already suspended.",expectedUpdatedAt:"2026-10-21T10:00:00Z",expectedProfileActive:false,expectedWorkerActive:false}];
let previewOverride:ReturnType<typeof fixture>|null=null;

before(()=>{
  process.env.NEXT_PUBLIC_SUPABASE_URL="https://bulk.example.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY="test-only-service-key-with-more-than32characters";
  process.env.WORK_EMAIL_CRYPTO_SECRET="test-only-signing-key-with-more-than32characters";
  process.env.ADMIN_EMAIL="operator@example.test";
  delete process.env.TRUSTED_CLIENT_IP_HEADER;delete process.env.VERCEL;
  globalThis.fetch=async(input,init)=>{
    const url=new URL(input instanceof Request?input.url:String(input));
    assert.equal(url.origin,"https://bulk.example.test","Never contact a real backend in tests");
    const body=typeof init?.body==="string"?JSON.parse(init.body):null;
    requests.push({path:url.pathname,body});
    if(url.pathname==="/auth/v1/user"){
      const isAdmin=new Headers(init?.headers).get("authorization")==="Bearer admin";
      return json({id:isAdmin?admin:worker,email:isAdmin?"operator@example.test":"worker@example.test",email_confirmed_at:"2026-01-01T00:00:00Z",is_anonymous:false});
    }
    if(url.pathname==="/rest/v1/profiles")return json([{worker_code:"WKR-TEST",active:true}]);
    if(url.pathname==="/rest/v1/workers")return json([{id:"WKR-TEST",active:true}]);
    if(url.pathname==="/rest/v1/rpc/app_is_admin"||url.pathname==="/rest/v1/rpc/consume_api_rate_limit")return json(true);
    if(url.pathname==="/rest/v1/rpc/preview_workers_bulk")return json(previewOverride??fixture());
    if(url.pathname==="/rest/v1/rpc/moderate_workers_bulk"){
      const prior=saved.get(body.p_operation_id);
      if(prior){
        if(prior.actor!==body.p_actor||prior.hash!==body.p_request_hash)return json({code:"P0001",message:"bulk_idempotency_conflict"},400);
        return json(prior.result);
      }
      if(expired)return json({code:"P0001",message:"bulk_preview_expired"},400);
      const items=(body.p_items as ReturnType<typeof fixture>).map(item=>({workerId:item.workerId,userId:item.userId,name:item.name,status:item.eligible?"success" as const:"skipped" as const,message:item.eligible?"Access suspended.":item.skipReason??"Skipped"}));
      const result:BulkResult={operationId:body.p_operation_id,action:body.p_action as BulkAction,items,succeeded:items.filter(item=>item.status==="success").length,skipped:items.filter(item=>item.status==="skipped").length,failed:0};
      saved.set(body.p_operation_id,{actor:body.p_actor,hash:body.p_request_hash,result});
      return json(result);
    }
    if(url.pathname==="/rest/v1/worker_bulk_operations"){
      const prior=saved.get((url.searchParams.get("id")??"").replace(/^eq\./,""));
      return json(prior&&url.searchParams.get("actor_id")==="eq."+prior.actor?[{result:prior.result}]:[]);
    }
    throw new Error("Unexpected test backend request "+url.pathname);
  };
});
after(()=>{globalThis.fetch=originalFetch;});

test("bulk selection validates before database access and signs only the reviewed canonical plan",async()=>{
  for(const input of [null,{}, {action:"unknown",workerIds:["WKR-TEST"]},{action:"suspend",workerIds:[]},{action:"suspend",workerIds:Array(101).fill("WKR-TEST")},{action:"suspend",workerIds:["unsafe,filter"]}]){
    requests.length=0;await assert.rejects(previewWorkerBulk(admin,input,null),ApiError);assert.equal(requests.length,0);
  }
  const preview=await previewWorkerBulk(admin,{action:"suspend",workerIds:["WKR-TEST","WKR-TEST"]},null);
  assert.equal(preview.eligibleCount,1);assert.equal(preview.skippedCount,1);assert.equal(preview.canBlockIps,false);
  assert.equal("expectedUpdatedAt" in preview.items[0],false);
  assert.deepEqual(requests.find(item=>item.path.endsWith("preview_workers_bulk"))?.body?.p_worker_ids,["WKR-TEST"]);
  const payload=JSON.parse(Buffer.from(preview.token.split(".")[0],"base64url").toString("utf8"));
  assert.equal(payload.actorId,admin);assert.equal(payload.action,"suspend");assert.equal(payload.items[0].expectedProfileActive,true);
});

test("tampering or reusing another administrator's signed preview never reaches mutation RPC",async()=>{
  const preview=await previewWorkerBulk(admin,{action:"suspend",workerIds:["WKR-TEST"]},null);
  for(const [actor,token] of [[admin,preview.token.replace(/^./,preview.token[0]==="a"?"b":"a")],[worker,preview.token]]){
    requests.length=0;
    await assert.rejects(applyWorkerBulk(actor,{previewToken:token,operationId:randomUUID(),reason:"Confirmed repeated policy violation"},null),error=>error instanceof ApiError&&error.code==="invalid_bulk_preview");
    assert.equal(requests.length,0);
  }
});

test("deletion confirmation and shared-network acknowledgement are checked against the signed eligible plan",async()=>{
  const deletion=await previewWorkerBulk(admin,{action:"delete",workerIds:["WKR-TEST"]},null);
  await assert.rejects(applyWorkerBulk(admin,{previewToken:deletion.token,operationId:randomUUID(),reason:"Confirmed repeated policy violation",confirmation:"DELETE 2 USERS"},null),error=>error instanceof ApiError&&error.code==="bulk_confirmation_required");
  assert.equal((await applyWorkerBulk(admin,{previewToken:deletion.token,operationId:randomUUID(),reason:"Confirmed repeated policy violation",confirmation:"DELETE 1 USERS"},null)).succeeded,1);
  const network=await previewWorkerBulk(admin,{action:"suspend_ip",workerIds:["WKR-TEST"]},"1.1.1.1");
  await assert.rejects(applyWorkerBulk(admin,{previewToken:network.token,operationId:randomUUID(),reason:"Confirmed repeated policy violation"},"1.1.1.1"),error=>error instanceof ApiError&&error.code==="bulk_network_confirmation_required");
});

test("retrying the same UUID returns a durable result even after expiry or a network change",async()=>{
  const now=Date.now;
  let preview;
  try{Date.now=()=>Date.parse("2000-01-01T00:00:00Z");preview=await previewWorkerBulk(admin,{action:"suspend",workerIds:["WKR-TEST"]},null);}finally{Date.now=now;}
  expired=false;
  const payload={previewToken:preview.token,operationId:randomUUID(),reason:"Confirmed repeated policy violation"};
  const first=await applyWorkerBulk(admin,payload,"1.1.1.1");
  expired=true;
  try{
    assert.deepEqual(await applyWorkerBulk(admin,payload,"8.8.8.8"),first);
    assert.deepEqual(await getWorkerBulkResult(admin,payload.operationId),first);
    await assert.rejects(getWorkerBulkResult(worker,payload.operationId),error=>error instanceof ApiError&&error.status===404);
    await assert.rejects(applyWorkerBulk(admin,{...payload,reason:"A different policy review reason"},null),error=>error instanceof ApiError&&error.code==="bulk_idempotency_conflict");
    await assert.rejects(applyWorkerBulk(admin,{...payload,operationId:randomUUID()},null),error=>error instanceof ApiError&&error.code==="bulk_preview_expired");
  }finally{expired=false;}
});

test("bulk preview/apply/recovery routes require administrator access and recover unavailable connection metadata",async()=>{
  const previewRoute=await import("../../app/api/admin/workers/bulk/preview/route");
  const applyRoute=await import("../../app/api/admin/workers/bulk/route");
  const context={params:Promise.resolve({})};
  const request=(path:string,method:string,body?:unknown,token="admin")=>new NextRequest("https://app.example.test"+path,{method,headers:{authorization:"Bearer "+token,"content-type":"application/json"},...(body?{body:JSON.stringify(body)}:{})});
  const forbidden=await previewRoute.POST(request("/api/admin/workers/bulk/preview","POST",{action:"suspend",workerIds:["WKR-TEST"]},"worker"),context);
  assert.equal(forbidden.status,403);
  process.env.TRUSTED_CLIENT_IP_HEADER="cf-connecting-ip";
  try{
    const read=await previewRoute.POST(request("/api/admin/workers/bulk/preview","POST",{action:"suspend",workerIds:["WKR-TEST"]}),context);
    assert.equal(read.status,200);
    const preview=(await read.json()).preview;
    assert.equal(preview.canBlockIps,false);
    const operationId=randomUUID();
    const applied=await applyRoute.POST(request("/api/admin/workers/bulk","POST",{previewToken:preview.token,operationId,reason:"Confirmed repeated policy violation"}),context);
    assert.equal(applied.status,200);
    const recovered=await applyRoute.GET(request("/api/admin/workers/bulk?operationId="+operationId,"GET"),context);
    assert.equal(recovered.status,200);
    assert.deepEqual((await recovered.json()).result,(await applied.json()).result);
  }finally{delete process.env.TRUSTED_CLIENT_IP_HEADER;}
});

test("100 long Unicode profiles keep their reviewed identities and fit the bounded bulk apply route",async()=>{
  const applyRoute=await import("../../app/api/admin/workers/bulk/route");
  const context={params:Promise.resolve({})};
  const name="😀".repeat(150);
  const email="𐐀".repeat(242)+"@example.com";
  previewOverride=Array.from({length:100},(_,index)=>({
    workerId:`WKR-UNICODE-${index}`,userId:randomUUID(),name,email,status:"active",eligible:true,
    expectedUpdatedAt:null,expectedProfileActive:true,expectedWorkerActive:true,
  }));
  try{
    const preview=await previewWorkerBulk(admin,{action:"suspend",workerIds:previewOverride.map(item=>item.workerId)},null);
    assert.equal(preview.eligibleCount,100);
    assert.equal(preview.items[0].name,name);
    assert.equal(preview.items[0].email,email);
    assert.ok(preview.token.length>128*1024,"exercise a token exceeding the former request limit");
    assert.ok(preview.token.length<320*1024,"the complete reviewed plan remains bounded");
    const body=JSON.stringify({previewToken:preview.token,operationId:randomUUID(),reason:"Confirmed repeated policy violation"});
    const request=(value:string)=>new NextRequest("https://app.example.test/api/admin/workers/bulk",{
      method:"POST",headers:{authorization:"Bearer admin","content-type":"application/json"},body:value,
    });
    const response=await applyRoute.POST(request(body),context);
    assert.equal(response.status,200);
    const result=(await response.json()).result;
    assert.equal(result.succeeded,100);
    assert.equal(result.items.length,100);
    assert.equal(result.items[0].name,name);
    requests.length=0;
    const oversized=JSON.stringify({previewToken:preview.token,operationId:randomUUID(),reason:"Confirmed repeated policy violation",padding:"x".repeat(384*1024)});
    const rejected=await applyRoute.POST(request(oversized),context);
    assert.equal(rejected.status,413);
    assert.equal((await rejected.json()).code,"payload_too_large");
    assert.equal(requests.some(item=>item.path.endsWith("/moderate_workers_bulk")),false,"oversized requests cannot reach the mutation transaction");
  }finally{previewOverride=null;}
});
