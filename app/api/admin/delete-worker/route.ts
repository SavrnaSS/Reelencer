import { NextResponse } from 'next/server';
import { withApi } from '@/lib/api/route';
import { authenticate } from '@/lib/api/auth';
import { ApiError, databaseError } from '@/lib/api/errors';
import { resolveWorkerUserId } from '@/lib/api/work';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
export const POST = withApi({ auth: 'admin', rateLimit: 6 }, async req => {
  const { workerId } = await req.json();
  if (typeof workerId !== 'string') throw new ApiError(400, 'A worker ID is required.');
  const actor = await authenticate(req);
  const id = await resolveWorkerUserId(workerId);
  const sb = supabaseAdmin();
  const prepared = await sb.rpc('prepare_worker_deletion', { p_actor: actor.user.id, p_worker: id });
  databaseError(prepared.error);
  const deleted = await sb.auth.admin.deleteUser(id);
  if (deleted.error) throw new ApiError(503, 'Worker access has been disabled; retry to finish deletion.');
  return NextResponse.json({ ok: true, workerId });
});
