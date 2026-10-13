import { NextResponse } from 'next/server';
import { authenticate } from './auth';
import { ApiError, databaseError } from './errors';
import { resolveWorkerUserId } from './work';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export async function removeAssignment(req: Request) {
  const body = req.method === 'DELETE'
    ? Object.fromEntries(new URL(req.url).searchParams)
    : await req.json();
  if (typeof body.workerId !== 'string' || typeof body.accountId !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(body.accountId)) {
    throw new ApiError(400, 'Worker and account IDs are required.');
  }
  const actor = await authenticate(req);
  const worker = await resolveWorkerUserId(body.workerId);
  const { data, error } = await supabaseAdmin().rpc('unassign_account', {
    p_actor: actor.user.id, p_worker: worker, p_account: body.accountId,
  });
  databaseError(error);
  return NextResponse.json(data);
}
