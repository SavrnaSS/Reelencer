export type PayoutHistoryItem = {
  id: string;
  amountINR: number;
  handle?: string;
  workItemTitle?: string;
  reelUrl?: string;
  reason?: string;
};

export type PayoutHistoryBatch = {
  id: string;
  status: string;
  createdAt: string;
  processedAt?: string;
  paidAt?: string;
  periodStart: string;
  periodEnd: string;
  method: string;
  origin?: "auto" | "manual";
  items: PayoutHistoryItem[];
  notes?: string[];
  paymentReference?: string;
};

/** Sum the frozen payout items in paise; malformed amounts cannot look like a verified total. */
export function payoutHistoryTotal(items: readonly Pick<PayoutHistoryItem, "amountINR">[]) {
  let paise = 0;
  for (const item of items) {
    if (!Number.isFinite(item.amountINR) || item.amountINR < 0) return undefined;
    paise += Math.round(item.amountINR * 100);
    if (!Number.isSafeInteger(paise)) return undefined;
  }
  return paise / 100;
}

export function payoutHistoryStatus(status: string) {
  switch (status.trim().toLowerCase()) {
    case "paid": return { label: "Paid", detail: "Payment completed.", tone: "success" as const };
    case "processing": return { label: "Processing", detail: "Your payment is being processed.", tone: "info" as const };
    case "failed": return { label: "Not completed", detail: "This payout was not completed. Review the notes below.", tone: "danger" as const };
    case "draft": return { label: "Requested", detail: "Awaiting review by the payout team.", tone: "pending" as const };
    default: return { label: "Status unavailable", detail: "Refresh to check this payout’s status.", tone: "neutral" as const };
  }
}

export function payoutEarningTitle(item: Pick<PayoutHistoryItem, "workItemTitle">) {
  const title = item.workItemTitle?.trim();
  // Older cached responses may only contain internal references. They never become display labels.
  return title && !/^(?:(?:VIEW|REEL)-)?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(title)
    ? title : "Approved earnings";
}

export function payoutHistoryDate(value: string | undefined, includeTime = false) {
  const date = new Date(value ?? "");
  if (!Number.isFinite(date.getTime())) return "Date unavailable";
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata",
    ...(includeTime ? { hour: "numeric", minute: "2-digit" } : {}),
  }).format(date);
}

export function payoutHistoryNotes(notes: readonly string[] = []) {
  return [...new Set(notes.filter(note => typeof note === "string").map(note => note.trim()).filter(note => note && !/^requested by worker$/i.test(note)))];
}
