import { NextResponse } from 'next/server';
import { withApi } from '@/lib/api/route';
import { databaseError } from '@/lib/api/errors';
import { workItemResponse } from '@/lib/api/work';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { getAdminWorkers } from '../_workers';
import { currentWorkerRecords } from '@/lib/adminWorkerDirectory';

export const GET=withApi({auth:'admin'},async()=>{
  const sb=supabaseAdmin();
  const [workers,accounts,assignments,legacy,items,upi]=await Promise.all([
    getAdminWorkers(sb),sb.from('accounts').select('*').order('id'),
    sb.from('assignments').select('worker_id,account_id,schedule'),
    sb.from('worker_account_assignments').select('worker_id,account_id,schedule'),
    sb.from('work_items').select('*').order('created_at',{ascending:false}).limit(1000),
    sb.from('upi_configs').select('*'),
  ]);
  for(const result of [accounts,assignments,legacy,items,upi]) databaseError(result.error);
  const codes=new Map(workers.map(worker=>[worker.userId,worker.id]));
  const unique=new Map<string,{workerId:string;accountId:string;schedule:unknown}>();
  for(const row of [...(assignments.data??[]),...(legacy.data??[])]) {
    unique.set(row.worker_id+':'+row.account_id,{workerId:codes.get(row.worker_id)??row.worker_id,accountId:row.account_id,schedule:row.schedule});
  }
  return NextResponse.json({ok:true,workers:currentWorkerRecords(workers),
    accounts:(accounts.data??[]).map(a=>({id:a.id,handle:a.handle,niche:a.niche,ownerTeam:a.owner_team,policyTier:a.policy_tier,health:a.health,rules:a.rules,allowedAudios:a.allowed_audios,requiredHashtags:a.required_hashtags})),
    assignments:[...unique.values()],
    workItems:(items.data??[]).map(row=>workItemResponse(row,codes.get(row.worker_id)??row.worker_id)),
    upiConfigs:(upi.data??[]).map(row=>({workerId:row.worker_id,workerCode:codes.get(row.worker_id),upiId:row.upi_id,verified:row.verified,verifiedAt:row.verified_at,payoutSchedule:row.payout_schedule,payoutDay:row.payout_day})),
  });
});
