import { NextResponse } from 'next/server';
import { withApi } from '@/lib/api/route';
import { authenticate } from '@/lib/api/auth';
import { ApiError, databaseError } from '@/lib/api/errors';
import { resolveActiveWorkerUserId } from '@/lib/api/work';
import { parseSchedule } from '@/lib/api/schedule';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
export const POST=withApi({auth:'admin'},async req=>{
  const actor=await authenticate(req);
  const body=await req.json().catch(()=>({}));
  const sb=supabaseAdmin();
  if(Boolean(body.workerId)!==Boolean(body.accountId)) throw new ApiError(400,'Specify both worker and account IDs.');
  const result=body.workerId && body.accountId
    ? await sb.rpc('schedule_account_work',{p_actor:actor.user.id,p_worker:await resolveActiveWorkerUserId(String(body.workerId)),p_account:String(body.accountId),p_schedule:parseSchedule(body.schedule),p_reschedule:body.reschedule===true,p_assign:false})
    : await sb.rpc('schedule_all_work',{p_actor:actor.user.id,p_schedule:body.schedule ? parseSchedule(body.schedule) : null,p_reschedule:body.reschedule===true});
  databaseError(result.error);
  return NextResponse.json(result.data);
});
