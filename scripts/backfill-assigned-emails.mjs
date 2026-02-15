import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

function makeEmail(gigId, workerId) {
  const short = `${gigId}-${workerId}`.replace(/[^a-zA-Z0-9]/g, "").slice(-10).toLowerCase();
  return `gig-${short}-${Math.random().toString(36).slice(2, 6)}@fasterdrop.site`;
}

function makeEmails(gigId, workerId, count, seed) {
  const emails = [];
  if (seed) emails.push(seed);
  while (emails.length < count) {
    const next = makeEmail(gigId, workerId);
    if (!emails.includes(next)) emails.push(next);
  }
  return emails;
}

const { data: assignments, error } = await sb
  .from("gig_assignments")
  .select("id, gig_id, worker_code, assigned_email, assigned_emails");

if (error) {
  console.error(error.message);
  process.exit(1);
}

let updated = 0;
for (const row of assignments ?? []) {
  const hasList = Array.isArray(row.assigned_emails) && row.assigned_emails.length >= 5;
  if (hasList) continue;
  const assignedEmail = row.assigned_email || makeEmail(row.gig_id, row.worker_code);
  const assignedEmails = makeEmails(row.gig_id, row.worker_code, 5, assignedEmail);

  const { error: updateError } = await sb
    .from("gig_assignments")
    .update({ assigned_emails: assignedEmails, assigned_email: assignedEmail })
    .eq("id", row.id);

  if (updateError) {
    console.error(`Failed ${row.id}: ${updateError.message}`);
    continue;
  }
  updated += 1;
}

console.log(`Backfill complete. Updated ${updated} assignments.`);
