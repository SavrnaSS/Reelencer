import "server-only";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { readCurrentApplications } from "./applicationReads";
import { decodeWorkerName } from "./gigApplications";
import { isContentPostingType } from "@/lib/accountSetup";
import { setupStage, type ActivityGig, type KycStage, type WorkerActivity } from "@/lib/workerActivity";

/**
 * Each creator's applications (with their Content Posting account setup stage, handle and bio code), KYC and join
 * date. Keyed by worker code and by user ID, since applications may be stored under either; both keys share a record.
 */
export async function loadWorkerActivity(sb: ReturnType<typeof supabaseAdmin>) {
  const [applications, gigsResult, profilesResult, kycResult] = await Promise.all([
    readCurrentApplications(sb),
    sb.from("gigs").select("id,title,company,gig_type"),
    sb.from("profiles").select("id,worker_code,created_at"),
    sb.from("worker_kyc").select("user_id,status"),
  ]);
  const gigs = new Map(((gigsResult.data ?? []) as Array<{ id: string; title: string; company: string; gig_type: string }>).map(gig => [String(gig.id), gig]));
  const profiles = (profilesResult.data ?? []) as Array<{ id: string; worker_code: string; created_at: string }>;
  const kyc = new Map(((kycResult.data ?? []) as Array<{ user_id: string; status: string }>).map(row => [row.user_id, row.status as KycStage]));

  const byAlias = new Map<string, WorkerActivity>();
  for (const profile of profiles) {
    const activity: WorkerActivity = { joinedAt: profile.created_at, kyc: kyc.get(profile.id) ?? "none", applications: [] };
    byAlias.set(String(profile.id), activity);
    if (profile.worker_code) byAlias.set(String(profile.worker_code), activity);
  }
  for (const row of applications) {
    const key = String(row.worker_code ?? "");
    let activity = byAlias.get(key);
    if (!activity) { activity = { kyc: "none", applications: [] }; byAlias.set(key, activity); }
    const gig = gigs.get(String(row.gig_id));
    const setup = decodeWorkerName(row.worker_name).proposal?.accountSetup as { status?: string; ownership?: string; handle?: string; verifyCode?: string } | undefined;
    activity.applications.push({
      gigId: String(row.gig_id),
      status: String(row.status ?? ""),
      appliedAt: String(row.applied_at ?? ""),
      setup: setupStage({ contentPosting: isContentPostingType(gig?.gig_type), status: String(row.status ?? ""), setup }),
      ...(setup?.handle ? { handle: String(setup.handle) } : {}),
      ...(setup?.verifyCode ? { code: String(setup.verifyCode) } : {}),
    });
  }
  for (const activity of new Set(byAlias.values())) activity.applications.sort((a, b) => Date.parse(b.appliedAt) - Date.parse(a.appliedAt));

  const usedGigs = new Set(applications.map(row => String(row.gig_id)));
  const gigList: ActivityGig[] = [...gigs.values()]
    .filter(gig => usedGigs.has(String(gig.id)))
    .map(gig => ({ id: String(gig.id), title: gig.title, company: gig.company, gigType: gig.gig_type }))
    .sort((a, b) => a.title.localeCompare(b.title));
  return { byAlias, gigs: gigList, gigsById: new Map(gigList.map(gig => [gig.id, gig])) };
}
