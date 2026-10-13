import { NextResponse } from 'next/server';
import { withApi } from '@/lib/api/route';
export const GET = withApi({auth:'public'},async()=>NextResponse.json({status:'ok'}));
