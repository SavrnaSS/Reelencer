import { NextResponse } from 'next/server';
import { withApi } from '@/lib/api/route';
import { databaseError } from '@/lib/api/errors';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
export const POST = withApi({auth:'service'},async()=>{
  const {data,error}=await supabaseAdmin().rpc('refresh_scheduled_work');
  databaseError(error);
  return NextResponse.json(data);
});
