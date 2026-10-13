import { NextResponse } from 'next/server';
import { withApi } from '@/lib/api/route';
import { authenticate } from '@/lib/api/auth';
import { ApiError, databaseError } from '@/lib/api/errors';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export const POST = withApi({ auth: 'admin' }, async req => {
  const { accountId } = await req.json();
  if (typeof accountId !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(accountId)) throw new ApiError(400, 'A valid account ID is required.');
  const actor = await authenticate(req);
  const { data, error } = await supabaseAdmin().rpc('delete_unused_account', { p_actor: actor.user.id, p_account: accountId });
  databaseError(error);
  return NextResponse.json(data);
});
