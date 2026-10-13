import test from 'node:test';
import assert from 'node:assert/strict';
import { createClient, type User } from '@supabase/supabase-js';
import { getAdminCredentials, getAdminEmail } from '../../lib/adminConfig';
import { AdminSetupError, syncAdminAccount } from '../../lib/adminProvisioning';

const id='77777777-7777-4777-8777-777777777777';
const credentials={email:'operator@example.test',password:'Test-only-strong-password-9284!',name:'Operator'};
type Options={existing?:boolean; unavailable?:boolean; failSave?:boolean; failConfigure?:boolean};
function fakeBackend(options:Options={}) {
  const calls:{method:string;path:string;body:Record<string,unknown>}[]=[];
  const user:User={id,email:credentials.email,email_confirmed_at:'2026-01-01T00:00:00Z',user_metadata:{locale:'en'},app_metadata:{},aud:'authenticated',created_at:'2026-01-01T00:00:00Z'};
  const client=createClient('https://admin-setup.example.test','test-service-key',{
    auth:{persistSession:false,autoRefreshToken:false},db:{retry:false},
    global:{fetch:async(input,init)=>{
      const url=new URL(String(input));
      assert.equal(url.origin,'https://admin-setup.example.test');
      const body=init?.body?JSON.parse(String(init.body)):{};
      calls.push({method:init?.method??'GET',path:url.pathname,body});
      let data:unknown=null;let status=200;
      if(url.pathname==='/rest/v1/rpc/reelencer_backend_version') {data=options.unavailable?{message:'secret backend details'}:3;status=options.unavailable?503:200;}
      else if(url.pathname==='/rest/v1/admin_owner')data=options.existing?[{user_id:id,email:credentials.email}]:[];
      else if(url.pathname==='/auth/v1/admin/users' && init?.method==='GET')data={users:options.existing?[user]:[],aud:'authenticated'};
      else if(url.pathname==='/rest/v1/rpc/configure_admin_owner') {data=options.failConfigure?{message:credentials.password,code:'P0001'}:{configured:true,userId:id};status=options.failConfigure?409:200;}
      else if(url.pathname==='/rest/v1/rpc/admin_configuration_ready')data=true;
      else if(url.pathname==='/auth/v1/admin/users' || url.pathname==='/auth/v1/admin/users/'+id) {data=options.failSave?{message:credentials.password}:user;status=options.failSave?422:200;}
      else throw new Error('Unexpected setup request: '+url.pathname);
      return new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json'}});
    }},
  });
  return {client,calls};
}

test('admin configuration normalizes the email and rejects missing or weak credentials',()=>{
  assert.equal(getAdminEmail({ADMIN_EMAIL:'  Operator@Example.test '}),'operator@example.test');
  assert.equal(getAdminEmail({}),null);
  assert.equal(getAdminEmail({ADMIN_EMAIL:'not-an-email'}),null);
  assert.throws(()=>getAdminCredentials({}),/ADMIN_EMAIL/);
  assert.throws(()=>getAdminCredentials({ADMIN_EMAIL:credentials.email,ADMIN_PASSWORD:'weak'}),/ADMIN_PASSWORD/);
  assert.equal(getAdminCredentials({ADMIN_EMAIL:credentials.email,ADMIN_PASSWORD:credentials.password}).password,credentials.password);
});

test('admin check performs no Auth or database writes and never returns the password',async()=>{
  const {client,calls}=fakeBackend({existing:true});
  const result=await syncAdminAccount(client,credentials,false);
  assert.equal(result.administratorMatches,true);
  assert.equal(result.passwordChecked,false);
  assert.ok(!calls.some(call=>call.path==='/rest/v1/rpc/configure_admin_owner'||(call.path.startsWith('/auth/')&&call.method!=='GET')));
  assert.ok(!JSON.stringify(result).includes(credentials.password));
});

test('admin provisioning creates a verified Auth identity then enrolls that exact user',async()=>{
  const {client,calls}=fakeBackend();
  const result=await syncAdminAccount(client,credentials,true);
  assert.equal(result.created,true);
  const created=calls.find(call=>call.path==='/auth/v1/admin/users'&&call.method==='POST');
  assert.equal(created?.body.password,credentials.password);
  assert.equal(created?.body.email_confirm,true);
  const enrolled=calls.find(call=>call.path==='/rest/v1/rpc/configure_admin_owner');
  assert.equal(enrolled?.body.p_user,id);
  assert.equal(enrolled?.body.p_expected_owner,null);
  assert.ok(!JSON.stringify(enrolled).includes(credentials.password));
  assert.ok(!JSON.stringify(result).includes(credentials.password));
});

test('existing administrator password updates keep the Auth user ID and preserve metadata',async()=>{
  const {client,calls}=fakeBackend({existing:true});
  const result=await syncAdminAccount(client,credentials,true);
  assert.equal(result.created,false);
  assert.ok(!calls.some(call=>call.path==='/auth/v1/admin/users'&&call.method==='POST'));
  const updated=calls.find(call=>call.path==='/auth/v1/admin/users/'+id);
  assert.equal(updated?.body.password,credentials.password);
  assert.deepEqual(updated?.body.user_metadata,{locale:'en',name:'Operator'});
  assert.equal(calls.find(call=>call.path==='/rest/v1/rpc/configure_admin_owner')?.body.p_expected_owner,id);
});

test('unavailable schema prevents credential changes and setup errors redact provider details',async()=>{
  const unavailable=fakeBackend({unavailable:true});
  await assert.rejects(syncAdminAccount(unavailable.client,credentials,true),/reachable Supabase/);
  assert.ok(!unavailable.calls.some(call=>call.path.startsWith('/auth/')));
  for(const options of [{failSave:true},{failConfigure:true}]) {
    const {client,calls}=fakeBackend(options);
    await assert.rejects(syncAdminAccount(client,credentials,true),error=>{
      assert.ok(error instanceof AdminSetupError);
      assert.equal(error.authUpdated,Boolean(options.failConfigure));
      assert.ok(!error.message.includes(credentials.password));
      return true;
    });
    assert.ok(!calls.some(call=>call.method==='DELETE'),'An ambiguous provisioning failure must not delete an identity');
  }
});
