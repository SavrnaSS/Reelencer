import { NextResponse } from 'next/server';
import { withApi } from '@/lib/api/route';
import { authenticate } from '@/lib/api/auth';
import { ApiError } from '@/lib/api/errors';
import { moderateWorker } from '@/lib/api/workerModeration';
import { optionalTrustedClientIp } from '@/lib/api/clientIp';
export const POST = withApi({ auth: 'admin', rateLimit: 6 }, async req => {
  const { workerId, reason, confirmation } = await req.json();
  if (typeof workerId !== 'string') throw new ApiError(400, 'A worker ID is required.');
  const actor = await authenticate(req);
  const moderation = await moderateWorker({
    actorId: actor.user.id, workerId, input: { action: 'delete', reason, confirmation }, actorIp: optionalTrustedClientIp(req),
  });
  return NextResponse.json({ ok: true, workerId, moderation });
});
