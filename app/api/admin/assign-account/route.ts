import { NextResponse } from 'next/server';
import { withApi } from '@/lib/api/route';
import { authenticate } from '@/lib/api/auth';
import { ApiError, databaseError } from '@/lib/api/errors';
import { resolveWorkerUserId } from '@/lib/api/work';
import { parseSchedule } from '@/lib/api/schedule';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
export const POST=withApi({auth:'admin'},async req=>{
  const body=await req.json();
  if(typeof body.workerId!=='string' || typeof body.accountId!=='string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(body.accountId)) throw new ApiError(400,'Worker and account IDs are required.');
  const actor=await authenticate(req);
  const worker=await resolveWorkerUserId(body.workerId);
  const {data,error}=await supabaseAdmin().rpc('schedule_account_work',{p_actor:actor.user.id,p_worker:worker,p_account:body.accountId,p_schedule:parseSchedule(body.schedule),p_reschedule:body.reschedule===true,p_assign:true});
  databaseError(error);
  return NextResponse.json(data);
});
