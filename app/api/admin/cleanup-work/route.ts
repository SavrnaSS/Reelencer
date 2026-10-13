import { NextResponse } from 'next/server';
import { withApi } from '@/lib/api/route';
import { authenticate } from '@/lib/api/auth';
import { ApiError, databaseError } from '@/lib/api/errors';
import { resolveWorkerUserId } from '@/lib/api/work';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
export const POST = withApi({ auth: 'admin' }, async req => {
  const body = await req.json();
  if (typeof body.workerId !== 'string' || typeof body.accountId !== 'string' || !body.accountId) throw new ApiError(400, 'Worker and account IDs are required.');
  const actor = await authenticate(req);
  const { data, error } = await supabaseAdmin().rpc('cleanup_scheduled_work', { p_actor: actor.user.id, p_worker: await resolveWorkerUserId(body.workerId), p_account: body.accountId });
  databaseError(error);
  return NextResponse.json(data);
});
