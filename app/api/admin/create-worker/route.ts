import { NextResponse } from 'next/server';
import { z } from 'zod';
import { withApi } from '@/lib/api/route';
import { authenticate } from '@/lib/api/auth';
import { ApiError, databaseError } from '@/lib/api/errors';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

const workerInput = z.object({
  workerId: z.string().trim().regex(/^[a-zA-Z0-9_-]{1,80}$/),
  name: z.string().trim().min(1).max(150),
  email: z.email().max(254).transform(value => value.toLowerCase()),
  password: z.string().min(12).max(128),
  active: z.boolean().default(true),
});

export const POST = withApi({ auth: 'admin', rateLimit: 6 }, async req => {
  const parsed = workerInput.safeParse(await req.json());
  if (!parsed.success) throw new ApiError(400, 'Provide a worker ID, name, valid email, and a password of 12–128 characters.');
  const { workerId, name, email, password, active } = parsed.data;
  const actor = await authenticate(req);
  const sb = supabaseAdmin();
  const existing = await sb.from('profiles').select('id').eq('worker_code', workerId).maybeSingle();
  databaseError(existing.error);
  if (existing.data) throw new ApiError(409, 'This worker ID is already in use.');
  const created = await sb.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { name, display_name: name } });
  if (created.error || !created.data.user) {
    if (created.error?.status === 422) throw new ApiError(409, 'This email is already registered or cannot be used.');
    throw new ApiError(503, 'Worker creation is temporarily unavailable.');
  }
  const id = created.data.user.id;
  const provisioned = await sb.rpc('provision_worker', { p_actor: actor.user.id, p_user: id, p_code: workerId, p_name: name, p_email: email, p_active: active });
  if (provisioned.error) {
    // Supabase Auth and PostgREST cannot share a transaction. Compensate only the newly created user.
    const cleanup = await sb.auth.admin.deleteUser(id);
    if (cleanup.error) console.error(JSON.stringify({ event: 'worker_provision_cleanup_failed', userId: id }));
    databaseError(provisioned.error);
  }
  return NextResponse.json({ ok: true, worker: provisioned.data }, { status: 201 });
});
