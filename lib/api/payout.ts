import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "./route";
import { authenticate } from "./auth";
import { ApiError, databaseError } from "./errors";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export function payoutAction(action: "approve" | "mark-paid" | "reject") {
  return withApi({ auth: "admin" }, async (req, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    if (!z.uuid().safeParse(id).success) throw new ApiError(400, "Invalid payout ID.");
    const body = await req.json().catch(() => ({}));
    let note: string | null = null;
    if (action === "mark-paid") {
      if (typeof body.paymentReference !== "string" || body.paymentReference.trim().length < 4 || body.paymentReference.length > 160) throw new ApiError(400, "Enter the payment transaction reference.");
      note = body.paymentReference.trim();
    } else if (action === "approve" && body.etaDate) {
      if (!z.iso.date().safeParse(body.etaDate).success) throw new ApiError(400, "Invalid ETA date.");
      note = body.etaDate;
    } else if (action === "reject") {
      note = String(body.reason || "Rejected by Admin").slice(0, 1000);
    }
    const actor = await authenticate(req);
    const { data, error } = await supabaseAdmin().rpc("transition_payout", { p_actor: actor.user.id, p_batch: id, p_action: action, p_note: note });
    databaseError(error);
    return NextResponse.json({ ok: true, batch: data });
  });
}
