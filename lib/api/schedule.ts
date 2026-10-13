import { z } from 'zod';
import { ApiError } from './errors';
const scheduleSchema=z.object({
  times:z.array(z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/)).min(1).max(6).default(['08:00','18:00']),
  days:z.array(z.number().int().min(0).max(6)).min(1).max(7).default([0,1,2,3,4,5,6]),
  deadlineMin:z.number().int().min(60).max(720).default(180),
  timezone:z.string().max(100).default('Asia/Kolkata').refine(value=>{try{new Intl.DateTimeFormat('en',{timeZone:value});return true;}catch{return false;}}),
});
export function parseSchedule(input:unknown) {
  const result=scheduleSchema.safeParse(input ?? {});
  if(!result.success) throw new ApiError(400,'Invalid schedule. Use valid times, weekdays and a time zone.');
  return {...result.data,times:[...new Set(result.data.times)],days:[...new Set(result.data.days)]};
}
