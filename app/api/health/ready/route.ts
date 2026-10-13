import { NextResponse } from 'next/server';
import { withApi } from '@/lib/api/route';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { getAdminEmail } from '@/lib/adminConfig';
export const GET = withApi({auth:'public'},async()=>{
  if ((process.env.WORK_EMAIL_CRYPTO_SECRET ?? '').length < 32 || (process.env.GIG_INBOX_INGEST_SECRET ?? '').length < 32 || (process.env.CRON_SECRET ?? '').length < 32) {
    return NextResponse.json({status:'not_ready'},{status:503});
  }
  const email=getAdminEmail();
  if(!email) return NextResponse.json({status:'not_ready'},{status:503});
  const sb=supabaseAdmin();
  const version=await sb.rpc('reelencer_backend_version');
  if(version.error || version.data!==3) return NextResponse.json({status:'not_ready'},{status:503});
  const owner=await sb.rpc('admin_configuration_ready',{p_email:email});
  const ready=!owner.error && owner.data===true;
  return NextResponse.json({status:ready?'ready':'not_ready'},{status:ready?200:503});
});
