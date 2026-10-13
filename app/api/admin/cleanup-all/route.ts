import { NextResponse } from 'next/server';
import { withApi } from '@/lib/api/route';
import { authenticate } from '@/lib/api/auth';
import { databaseError } from '@/lib/api/errors';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
export const POST = withApi({ auth: 'admin' }, async req => {
  const actor = await authenticate(req);
  const { data, error } = await supabaseAdmin().rpc('cleanup_scheduled_work', { p_actor: actor.user.id });
  databaseError(error);
  return NextResponse.json(data);
});
