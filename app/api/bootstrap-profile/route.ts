import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const userId = String(body.userId || "");
    const email = String(body.email || "");

    if (!userId) return NextResponse.json({ error: "userId is required" }, { status: 400 });

    // Ensure profile exists
    const { data, error } = await supabaseAdmin
      .from("profiles")
      .upsert(
        {
          id: userId,
          role: "Worker",
          display_name: email || null,
        },
        { onConflict: "id" }
      )
      .select("id, role, worker_code")
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({
      id: data.id,
      role: data.role,
      workerCode: data.worker_code ?? null,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Unknown error" }, { status: 500 });
  }
}
