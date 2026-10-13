export type ViewAuthenticity = "unreviewed" | "organic" | "mixed" | "suspected" | "insufficient";
export type ViewClaimItem = { id: string; post_id: string; url: string; from_views: number; to_views: number; amount_inr: number; source: string; captured_at: string; excluded_views?: number; reviewed_amount_inr?: number | null; deduction_reason?: string; evidence_url?: string };
export type ViewClaim = { id: string; worker_id: string; status: string; amount_inr: number; rate_inr: number; views: number; note: string; created_at: string; work_item_id?: string; authenticity_review?: ViewAuthenticity; approved_views?: number | null; deducted_views?: number | null; approved_amount_inr?: number | null; worker?: { worker_code: string; display_name: string }; account?: { handle: string; gig?: { title: string } }; view_payout_claim_items: ViewClaimItem[] };
export type ViewAdjustment = { itemId: string; excludedViews: number; reason: string; evidenceUrl?: string };
export type ViewReviewRequest = { action: "review"; claimId: string; decision: "Approved" | "Rejected" | "Hard rejected"; note: string; assessment: Exclude<ViewAuthenticity, "unreviewed">; adjustments: ViewAdjustment[] };
export type ViewObservation = { captured_at: string; views: number; likes: number | null; comments: number | null; source: string };
export type ViewReviewEvidence = { itemId: string; currentViews?: number; currentStatus?: string; capturedAt?: string; observations: ViewObservation[]; interactionRate?: number; flags: string[] };

/** Same cumulative rounding as the database; excluded views retain their consumed range. */
export function adjustedViewAmount(item: Pick<ViewClaimItem, "from_views" | "to_views">, rate: number, excluded: number) {
  const from = Number(item.from_views), to = Number(item.to_views);
  if (![from, to, excluded].every(Number.isSafeInteger) || from < 0 || to <= from || excluded < 0 || excluded > to - from || !Number.isFinite(rate) || rate <= 0) throw new Error("Invalid view adjustment.");
  const cents = BigInt(Math.round(rate * 100));
  const cumulative = (n: number) => (BigInt(n) * cents + BigInt(500)) / BigInt(1000);
  return Number(cumulative(to - excluded) - cumulative(from)) / 100;
}

/** Signals describe the available evidence, never a verdict about individual viewers. */
export function viewReviewEvidence(item: ViewClaimItem, current: { views?: number | null; status?: string; views_captured_at?: string | null } | undefined, observations: ViewObservation[], now = Date.now()): ViewReviewEvidence {
  const flags: string[] = [];
  const points = observations.filter(p => Number.isSafeInteger(Number(p.views)) && Number(p.views) >= 0 && Number.isFinite(Date.parse(p.captured_at))).sort((a, b) => Date.parse(a.captured_at) - Date.parse(b.captured_at)).slice(-30);
  const latest = points.at(-1);
  const previous = points.at(-2);
  const rates = points.slice(1, -1).map((p, index) => {
    const hours = (Date.parse(p.captured_at) - Date.parse(points[index].captured_at)) / 3_600_000;
    return hours > 0 && p.source === points[index].source && Number(p.views) >= Number(points[index].views) ? (Number(p.views) - Number(points[index].views)) / hours : undefined;
  }).filter((n): n is number => n !== undefined).sort((a, b) => a - b);
  if (rates.length >= 3 && latest && previous) {
    const median = rates[Math.floor(rates.length / 2)];
    const hours = (Date.parse(latest.captured_at) - Date.parse(previous.captured_at)) / 3_600_000;
    const delta = Number(latest.views) - Number(previous.views);
    if (hours > 0 && latest.source === previous.source && delta >= 1000 && median > 0 && delta / hours >= median * 5) flags.push("Latest measured view growth exceeds five times the earlier median pace. Inspect supporting insights.");
  }
  if (current?.status !== "approved") flags.push("Reel is no longer approved, or its current evidence is unavailable.");
  if (current?.views == null) flags.push("Current view count is unavailable.");
  else if (Number(current.views) < Number(item.to_views)) flags.push("Current view count is below this claim’s frozen evidence. Approval is blocked.");
  if (now - Date.parse(item.captured_at) > 24 * 3_600_000) flags.push("The claimed measurement is older than 24 hours.");
  if (points.length < 5) flags.push("Limited measurement history; use creator insights or other supporting evidence.");
  if (new Set(points.map(p => p.source)).size > 1) flags.push("History combines different measurement sources. Compare matching sources and supporting insights.");
  if (points.some((p, index) => index > 0 && Number(p.views) < Number(points[index - 1].views))) flags.push("Observed view counts decreased. Check for platform corrections or cached readings.");
  const interactionRate = latest && Number(latest.views) > 0 && latest.likes !== null && latest.comments !== null ? (Number(latest.likes) + Number(latest.comments)) / Number(latest.views) * 100 : undefined;
  if (interactionRate !== undefined && latest && Number(latest.views) >= 10_000 && interactionRate < 0.1) flags.push("Fewer than one like or comment per 1,000 views in the latest observation. This can also occur with organic traffic.");
  return { itemId: item.id, currentViews: current?.views == null ? undefined : Number(current.views), currentStatus: current?.status, capturedAt: current?.views_captured_at ?? undefined, observations: points, interactionRate, flags };
}
