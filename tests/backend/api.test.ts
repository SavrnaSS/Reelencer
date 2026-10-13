import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { NextRequest } from 'next/server';
import { withApi } from '../../lib/api/route';
import { authenticate } from '../../lib/api/auth';
import { encryptSecretText, decryptSecretText } from '../../lib/secretCrypto';
import { validateUpload, ownedStoragePath } from '../../lib/api/uploads';

const worker = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const assignment = '44444444-4444-4444-8444-444444444444';
const originalFetch = globalThis.fetch;
const requests: { path: string; query: string; method: string; token: string }[]=[];
let unavailable = false;
let confirmed = true;
let active = true;
let registeredAdmin = true;
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json'}});

before(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL='https://backend.example.test';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY='test-anon-key';
  process.env.SUPABASE_SERVICE_ROLE_KEY='test-service-key';
  process.env.ADMIN_EMAIL='operator@example.test';
  process.env.WORK_EMAIL_CRYPTO_SECRET='test-only-crypto-key-with-32-characters-minimum';
  process.env.GIG_INBOX_INGEST_SECRET='test-only-webhook-secret-with-32-characters';
  process.env.NEXT_PUBLIC_ENABLE_DEMO_MODE='false';
  globalThis.fetch = async (input, init) => {
    const url=new URL(input instanceof Request ? input.url : String(input));
    assert.equal(url.origin,'https://backend.example.test','Tests must never contact an external service');
    const token = new Headers(init?.headers).get('authorization') ?? '';
    requests.push({path:url.pathname,query:url.search,method:init?.method ?? 'GET',token});
    if(unavailable) return json({message:'internal database host and secret'},503);
    if(url.pathname==='/auth/v1/user') {
      if(token==='Bearer invalid') return json({message:'Invalid token'},401);
      const isAdmin=token==='Bearer admin';
      return json({id:isAdmin?'33333333-3333-4333-8333-333333333333':worker,email:isAdmin?'operator@example.test':'worker@example.test',email_confirmed_at:confirmed?'2026-01-01T00:00:00Z':null,is_anonymous:false,user_metadata:{role:'Admin'}});
    }
    if(url.pathname==='/rest/v1/profiles') return json([{id:worker,worker_code:'WKR-TEST',role:'Worker',active}]);
    if(url.pathname==='/rest/v1/workers') return json([{id:'WKR-TEST',user_id:worker,active,name:'Worker'}]);
    if(url.pathname==='/rest/v1/gig_assignments') return json([{id:assignment,worker_code:'WKR-OTHER',gig_id:'gig-1',assigned_emails:[]}]);
    if(url.pathname==='/rest/v1/rpc/consume_api_rate_limit') return json(true);
    if(url.pathname==='/rest/v1/rpc/app_is_admin') return json(registeredAdmin);
    if(url.pathname==='/rest/v1/gigs') return json([{id:'gig-1',status:'Open',gig_type:'Project'}]);
    if(url.pathname==='/rest/v1/gig_applications') return json([]);
    if(url.pathname==='/rest/v1/rpc/worker_metrics') return json({money:{earnings:3064.09,pending:1622.64}});
    if(url.pathname==='/rest/v1/work_items') return json([{id:'available',reward_inr:'64.09'},{id:'paid',reward_inr:'1000.00'},{id:'reserved',reward_inr:'2000.00'}]);
    if(url.pathname==='/rest/v1/payout_items') return json([{id:'p1',work_item_id:'paid'},{id:'p2',work_item_id:'reserved'}]);
    throw new Error('Unexpected backend request: '+url.pathname);
  };
});
after(()=>{globalThis.fetch=originalFetch;});
const ctx={params:Promise.resolve({id:assignment})};
function req(route:string,method='GET',body?:string,token?:string,extra:Record<string,string>={}) {
  return new NextRequest('https://app.example.test'+route,{method,headers:{...(token?{authorization:'Bearer '+token}:{}),...(body?{'content-type':'application/json'}:{}),...extra},body});
}

async function routeFiles(dir:string):Promise<string[]> {
  const out:string[]=[];
  for(const entry of await readdir(dir,{withFileTypes:true})) {
    const file=path.join(dir,entry.name);
    if(entry.isDirectory()) out.push(...await routeFiles(file));
    else if(entry.name==='route.ts') out.push(file);
  }
  return out;
}

test('public sign-up, resend and password reset validate input before touching auth or the mailer',async()=>{
  const signup=(await import('../../app/api/auth/signup/route')).POST;
  const resend=(await import('../../app/api/auth/resend/route')).POST;
  const reset=(await import('../../app/api/auth/password-reset/route')).POST;
  const cases:[typeof signup,string,string][]=[
    [signup,'/api/auth/signup',JSON.stringify({email:'not-an-email',password:'long-enough'})],
    [signup,'/api/auth/signup',JSON.stringify({email:'new@example.test',password:'123'})],
    [resend,'/api/auth/resend',JSON.stringify({email:'nope'})],
    [reset,'/api/auth/password-reset',JSON.stringify({email:'nope'})],
  ];
  for(const [handler,route,body] of cases) {
    requests.length=0;
    const result:Response=await handler(req(route,'POST',body),ctx);
    assert.equal(result.status,400,route+' '+body);
    assert.equal(requests.length,0,'No auth or database access for invalid input: '+route);
  }
  const crossSite=await signup(req('/api/auth/signup','POST',JSON.stringify({email:'a@example.test',password:'123456'}),undefined,{origin:'https://evil.example'}),ctx);
  assert.equal(crossSite.status,403);
});

test('every private API method rejects unauthenticated calls before database access',async()=>{
  let checked=0;
  for(const file of await routeFiles('app/api')) {
    const route='/'+file.replace(/^app\//,'').replace(/\/route.ts$/,'').replace(/\[id\]/g,assignment);
    const mod=await import(pathToFileURL(path.resolve(file)).href);
    for(const method of ['GET','POST','PUT','PATCH','DELETE']) {
      if(typeof mod[method]!=='function') continue;
      if(['/api/auth/logout','/api/auth/signup','/api/auth/resend','/api/auth/password-reset','/api/gig-inbox/ingest','/api/gig-inbox/poll','/api/health','/api/health/ready'].includes(route) || (route==='/api/gigs' && method==='GET'))continue;
      requests.length=0;
      const result:Response=await mod[method](req(route,method),ctx);
      assert.equal(result.status,401,method+' '+route);
      assert.equal(requests.length,0,'No database access before authentication: '+route);
      assert.match(result.headers.get('cache-control')??'',/no-store/);
      checked++;
    }
  }
  assert.ok(checked>=70,'Expected complete route coverage, got '+checked);
});

test('admin authorization ignores spoofed headers and user metadata',async()=>{
  const handler=withApi({auth:'admin'},async()=>json({ok:true}));
  const response=await handler(req('/api/admin/snapshot','GET',undefined,'worker',{'x-dev-bypass':'1','x-dev-admin-email':'operator@example.test'}),ctx);
  assert.equal(response.status,403);
});

test('administrator access requires the environment and database identity to agree',async()=>{
  const handler=withApi({auth:'admin'},async()=>json({ok:true}));
  const previous=process.env.ADMIN_EMAIL;
  try {
    assert.equal((await handler(req('/api/admin/snapshot','GET',undefined,'admin'),ctx)).status,200);
    registeredAdmin=false;
    assert.equal((await handler(req('/api/admin/snapshot','GET',undefined,'admin'),ctx)).status,403);
    registeredAdmin=true;
    process.env.ADMIN_EMAIL='replacement@example.test';
    assert.equal((await handler(req('/api/admin/snapshot','GET',undefined,'admin'),ctx)).status,403);
    delete process.env.ADMIN_EMAIL;
    assert.equal((await handler(req('/api/admin/snapshot','GET',undefined,'admin'),ctx)).status,403);
  } finally { process.env.ADMIN_EMAIL=previous; registeredAdmin=true; }
});

test('worker wallet reports unreserved credits in paise and keeps another worker inaccessible',async()=>{
  const { GET }=await import('../../app/api/metrics/worker/route');
  requests.length=0;
  const response=await GET(req('/api/metrics/worker?workerId=WKR-TEST','GET',undefined,'worker'),ctx);
  assert.equal(response.status,200);
  assert.deepEqual((await response.json()).money,{earnings:3064.09,pending:1622.64,available:64.09,committed:3000});
  const creditRequest=requests.find(request=>request.path==='/rest/v1/work_items')!;
  const creditQuery=new URLSearchParams(creditRequest.query);
  assert.equal(creditQuery.get('worker_id'),'eq.'+worker);
  assert.equal(creditQuery.get('status'),'eq.Approved');
  assert.equal(creditQuery.get('reward_inr'),'gt.0');
  const reservationQuery=new URLSearchParams(requests.find(request=>request.path==='/rest/v1/payout_items')!.query);
  assert.equal(reservationQuery.get('worker_id'),'eq.'+worker);
  assert.equal(reservationQuery.get('status'),'neq.Failed');
  requests.length=0;
  assert.equal((await GET(req('/api/metrics/worker?workerId=WKR-OTHER','GET',undefined,'worker'),ctx)).status,403);
  assert.equal(requests.some(request=>request.path==='/rest/v1/work_items'),false);
});

test('identity endpoint returns a verified role without configuration or password fields',async()=>{
  const { GET }=await import('../../app/api/me/route');
  const adminResponse=await GET(req('/api/me','GET',undefined,'admin'),ctx);
  assert.equal(adminResponse.status,200);
  const identity=await adminResponse.json();
  assert.equal(identity.role,'admin');
  assert.deepEqual(Object.keys(identity).sort(),['email','id','role','workerId']);
  registeredAdmin=false;
  try {
    assert.equal((await (await GET(req('/api/me','GET',undefined,'admin'),ctx)).json()).role,'worker');
  } finally { registeredAdmin=true; }
});

test('scheduled jobs require the independent service secret',async()=>{
  const previous=process.env.CRON_SECRET;
  process.env.CRON_SECRET='independent-cron-secret-at-least-32-characters';
  const handler=withApi({auth:'service'},async()=>json({ok:true}));
  try {
    assert.equal((await handler(req('/api/jobs/schedule','POST','{}','worker'),ctx)).status,401);
    assert.equal((await handler(req('/api/jobs/schedule','POST','{}',process.env.CRON_SECRET),ctx)).status,200);
  } finally {
    if(previous===undefined)delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET=previous;
  }
});

test('invalid, unconfirmed and inactive identities cannot use API',async()=>{
  const handler=withApi({auth:'user'},async()=>json({ok:true}));
  assert.equal((await handler(req('/api/me','GET',undefined,'invalid'),ctx)).status,401);
  confirmed=false;
  assert.equal((await handler(req('/api/me','GET',undefined,'worker'),ctx)).status,401);
  confirmed=true; active=false;
  assert.equal((await handler(req('/api/me','GET',undefined,'worker'),ctx)).status,403);
  active=true;
});

test('cross-worker query parameters and assignment ownership fail closed',async()=>{
  const handler=withApi({auth:'user'},async()=>json({ok:true}));
  assert.equal((await handler(req('/api/workitems?workerId='+other,'GET',undefined,'worker'),ctx)).status,403);
  const {GET}=await import('../../app/api/gig-credentials/route');
  const result=await GET(req('/api/gig-credentials?assignmentId='+assignment,'GET',undefined,'worker'),ctx);
  assert.equal(result.status,404);
  assert.ok(!requests.some(r=>r.path==='/rest/v1/gig_account_credentials'));
});

test('workers cannot approve assignments or change application decisions',async()=>{
  const {PATCH}=await import('../../app/api/gig-assignments/route');
  const response=await PATCH(req('/api/gig-assignments','PATCH',JSON.stringify({id:assignment,updates:{status:'Accepted',releaseFundsNow:true}}),'worker'),ctx);
  assert.equal(response.status,403);
});

test('payload limits, malformed JSON and cross-origin writes return useful errors',async()=>{
  let called=false;
  const handler=withApi({auth:'user',maxBytes:30},async request=>{called=true;await authenticate(request);return json({ok:true});});
  assert.equal((await handler(req('/api/test','POST','{"x":"'+'a'.repeat(40)+'"}','worker'),ctx)).status,413);
  assert.equal((await handler(req('/api/test','POST','{','worker'),ctx)).status,400);
  assert.equal((await handler(req('/api/test','POST','{}','worker',{origin:'https://attacker.test'}),ctx)).status,403);
  assert.equal(called,false);
  requests.length=0;
  assert.equal((await handler(req('/api/test','POST','{}','worker'),ctx)).status,200);
  assert.equal(requests.filter(r=>r.path==='/auth/v1/user').length,1,'Reuse verification within one request');
});

test('provider outages remain 503 and never leak database internals',async()=>{
  unavailable=true;
  const handler=withApi({auth:'user'},async()=>json({ok:true}));
  const response=await handler(req('/api/me','GET',undefined,'worker'),ctx);
  unavailable=false;
  assert.equal(response.status,503);
  assert.ok(!(await response.text()).includes('internal database host'));
  assert.ok(response.headers.get('x-request-id'));
});

test('credentials require a key and authenticated ciphertext; plaintext is rejected',()=>{
  const encrypted=encryptSecretText('secret-password');
  assert.ok(!encrypted.includes('secret-password'));
  assert.equal(decryptSecretText(encrypted),'secret-password');
  assert.throws(()=>decryptSecretText('legacy-plaintext'));
  const old=process.env.WORK_EMAIL_CRYPTO_SECRET;
  process.env.WORK_EMAIL_CRYPTO_SECRET='';
  assert.throws(()=>encryptSecretText('never-store-this'));
  process.env.WORK_EMAIL_CRYPTO_SECRET=old;
  const corrupted=Buffer.from(encrypted.slice(7),'base64');corrupted[corrupted.length-1]^=1;
  assert.throws(()=>decryptSecretText('enc:v1:'+corrupted.toString('base64')));
});

test('uploads reject spoofed MIME types and cross-user storage paths',async()=>{
  await assert.rejects(validateUpload(new File(['<script>bad()</script>'],'id.png',{type:'image/png'}),['image/png'],1024));
  assert.equal(ownedStoragePath('presentation-video/'+other+'/file.mp4','presentation-video/'+worker+'/'),false);
  assert.equal(ownedStoragePath('kyc/'+worker+'/../other','kyc/'+worker+'/'),false);
  await validateUpload(new File([new Uint8Array([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a])],'id.png',{type:'image/png'}),['image/png'],1024);
});

test('view authenticity evidence and review are admin-only and browser-supplied money is rejected',async()=>{
  const {GET,POST}=await import('../../app/api/view-payout-claims/route');
  const payload={action:'review',claimId:assignment,decision:'Approved',assessment:'mixed',note:'Reviewed evidence',adjustments:[{itemId:assignment,excludedViews:10,reason:'Supporting insights identify artificial views'}]};
  requests.length=0;
  const forbidden=await POST(req('/api/view-payout-claims','POST',JSON.stringify(payload),'worker'),ctx);
  assert.equal(forbidden.status,403);
  assert.equal(requests.some(r=>r.path.endsWith('/review_view_payout_claim_authenticity')),false);
  const evidence=await GET(req('/api/view-payout-claims?reviewClaimId='+assignment,'GET',undefined,'worker'),ctx);
  assert.equal(evidence.status,403);
  for(const input of [{...payload,amount:0.01},{...payload,adjustments:[{...payload.adjustments[0],excludedViews:0.5}]},{...payload,adjustments:[{...payload.adjustments[0],evidenceUrl:'javascript:alert(1)'}]}]) {
    const result=await POST(req('/api/view-payout-claims','POST',JSON.stringify(input),'admin'),ctx);
    assert.equal(result.status,400);
  }
});
