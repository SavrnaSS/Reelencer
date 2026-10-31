import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api/route";
import { authenticate } from "@/lib/api/auth";
import { ApiError, databaseError } from "@/lib/api/errors";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { ACCOUNT_HOLDER_PATTERN, IFSC_PATTERN, maskAccountNumber, normalizeAccountHolder, normalizeAccountNumber, normalizeIfsc, parseDestination, UPI_PATTERN } from "@/lib/payoutDestination";

// The creator's payout method. A bank account number is only ever returned masked (the team sees it in full).
function response(row: Record<string, unknown> | null) {
  const destination = parseDestination(typeof row?.upi_id === "string" ? row.upi_id : "");
  const bank = destination?.method === "Bank"
    ? { holderName: String(row?.bank_holder_name ?? ""), accountNumberMasked: maskAccountNumber(destination.accountNumber), ifsc: destination.ifsc }
    : undefined;
  return {
    method: destination?.method ?? "UPI",
    upiId: destination?.method === "UPI" ? destination.upiId : "",
    ...(bank ? { bank } : {}),
    verified: row?.verified ?? false, verifiedAt: row?.verified_at ?? undefined, updatedAt: row?.updated_at ?? undefined,
    payoutSchedule: row?.payout_schedule ?? "Weekly", payoutDay: row?.payout_day ?? "Fri",
    autoWithdraw: row?.auto_withdraw === true, autoWithdrawSince: row?.auto_withdraw_since ?? undefined,
  };
}
export const GET = withApi({ auth: "user" }, async req => {
  const actor = await authenticate(req);
  const { data, error } = await supabaseAdmin().from("upi_configs").select("*").eq("worker_id", actor.user.id).maybeSingle();
  databaseError(error);
  return NextResponse.json(response(data));
});
// New clients send a payout method; older ones send only a UPI ID with a schedule.
const methodSchema = z.discriminatedUnion("method", [
  z.object({ method: z.literal("UPI"), upiId: z.string().trim().min(5).max(100).regex(UPI_PATTERN) }),
  z.object({
    method: z.literal("Bank"),
    accountHolder: z.string().transform(normalizeAccountHolder).pipe(z.string().min(2).max(100).regex(ACCOUNT_HOLDER_PATTERN)),
    accountNumber: z.string().transform(normalizeAccountNumber).pipe(z.string().regex(/^[0-9]{9,18}$/)),
    ifsc: z.string().transform(normalizeIfsc).pipe(z.string().regex(IFSC_PATTERN)),
  }),
]);
const upiSchema = z.object({ upiId: z.string().trim().min(5).max(100).regex(/^[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+$/), payoutSchedule: z.enum(["Weekly", "Monthly"]).default("Weekly"), payoutDay: z.string().max(10).default("Fri") });
export const PUT = withApi({ auth: "user", rateLimit: 20 }, async req => {
  const actor = await authenticate(req);
  const body = await req.json().catch(() => null);
  if (body && typeof body === "object" && "method" in body) {
    const method = methodSchema.safeParse(body);
    if (!method.success) {
      throw new ApiError(400, body.method === "Bank"
        ? "Check the bank details: the account holder's name, a 9–18 digit account number and an 11-character IFSC (e.g. HDFC0001234)."
        : "Enter a valid UPI ID like name@okhdfcbank.", "invalid_payout_method");
    }
    const input = method.data;
    const { data, error } = await supabaseAdmin().rpc("save_payout_method", {
      p_worker: actor.user.id, p_method: input.method,
      p_upi: input.method === "UPI" ? input.upiId : null,
      p_holder: input.method === "Bank" ? input.accountHolder : null,
      p_account: input.method === "Bank" ? input.accountNumber : null,
      p_ifsc: input.method === "Bank" ? input.ifsc : null,
    });
    databaseError(error);
    return NextResponse.json(response(data));
  }
  const parsed = upiSchema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "Invalid UPI configuration.");
  const { payoutSchedule, payoutDay } = parsed.data;
  if (payoutSchedule === "Weekly" ? !["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].includes(payoutDay) : !/^(?:[1-9]|1\d|2[0-8])$/.test(payoutDay)) throw new ApiError(400, "Choose a valid payout day (monthly: 1–28).");
  const sb = supabaseAdmin();
  const { data, error } = await sb.rpc("save_upi_config", { p_worker: actor.user.id, p_upi: parsed.data.upiId, p_schedule: payoutSchedule, p_day: payoutDay });
  databaseError(error);
  return NextResponse.json(response(data));
});

// Monthly auto-withdrawal: switch it on or off and choose its day (1–28). Needs a saved payout method.
const autoSchema = z.object({ autoWithdraw: z.boolean(), autoDay: z.number().int().min(1).max(28) });
export const PATCH = withApi({ auth: "user", rateLimit: 20 }, async req => {
  const actor = await authenticate(req);
  const parsed = autoSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw new ApiError(400, "Choose an auto-withdrawal day from the 1st to the 28th.");
  const { data, error } = await supabaseAdmin().rpc("set_auto_withdrawal", { p_worker: actor.user.id, p_enabled: parsed.data.autoWithdraw, p_day: parsed.data.autoDay });
  databaseError(error);
  return NextResponse.json(response(data));
});
