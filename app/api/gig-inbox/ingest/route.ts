import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { simpleParser } from "mailparser";
import { createHash } from "crypto";

export const runtime = "nodejs";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
  Pragma: "no-cache",
  Expires: "0",
};

function normalizeText(text: string | null | undefined) {
  return (text ?? "").toString().trim();
}

function stripHtml(html: string) {
  return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function extractBodyFromRaw(raw: string) {
  const parts = raw.split(/\r?\n\r?\n/);
  if (parts.length <= 1) return "";
  const body = parts.slice(1).join("\n\n").trim();
  return body;
}

function clampText(text: string, max: number) {
  if (text.length <= max) return text;
  return text.slice(0, max);
}

function pickBodyText(text: string) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const dropPrefixes = [
    "delivered-to:",
    "received:",
    "x-forwarded-",
    "x-received:",
    "arc-",
    "authentication-results:",
    "dkim-signature:",
  ];

  const filtered = lines.filter(
    (line) => !dropPrefixes.some((p) => line.toLowerCase().startsWith(p))
  );

  const notHeaderish = filtered.filter(
    (line) =>
      !/^(mon|tue|wed|thu|fri|sat|sun),/i.test(line) &&
      !/\b(?:pst|gmt|utc)\b/i.test(line) &&
      !/;\s*s=arc/i.test(line)
  );

  const pick = notHeaderish[0] || filtered[0] || lines[0] || "";
  return pick.length > 400 ? pick.slice(0, 400) : pick;
}

function extractOtp(text: string) {
  const match = text.match(/\b\d{6}\b/);
  return match ? match[0] : null;
}

function normalizeEmail(value: string | null | undefined) {
  return normalizeText(value).toLowerCase();
}

function extractFirstEmail(value: string | null | undefined) {
  const raw = normalizeText(value);
  if (!raw) return "";
  const angle = raw.match(/<([^>]+)>/);
  if (angle?.[1]) return normalizeEmail(angle[1]);
  const match = raw.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match ? normalizeEmail(match[0]) : normalizeEmail(raw);
}

export async function POST(req: Request) {
  try {
    const secret = process.env.GIG_INBOX_INGEST_SECRET;
    const provided = req.headers.get("x-inbox-secret") || "";
    if (!secret || provided !== secret) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401, headers: NO_STORE_HEADERS }
      );
    }

    const body = await req.json().catch(() => null);
    const raw = normalizeText(body?.raw);
    if (!raw) {
      return NextResponse.json(
        { error: "raw email required" },
        { status: 400, headers: NO_STORE_HEADERS }
      );
    }

    const parsed = await simpleParser(raw);
    const parsedTo =
      parsed.to?.value?.map((v) => normalizeEmail(v.address)).filter(Boolean) ?? [];
    const toEmail =
      extractFirstEmail(body?.to) ||
      parsedTo[0] ||
      normalizeEmail(parsed.headers?.get?.("delivered-to") as any);

    if (!toEmail) {
      return NextResponse.json(
        { error: "Unable to determine recipient" },
        { status: 400, headers: NO_STORE_HEADERS }
      );
    }

    const sb = supabaseAdmin();
    let assignment: any = null;
    const { data: assignmentByList, error: listError } = await sb
      .from("gig_assignments")
      .select("id, assigned_email, assigned_emails, subject_filter")
      .contains("assigned_emails", [toEmail])
      .maybeSingle();

    if (!listError) {
      assignment = assignmentByList;
    } else if (String(listError.message || "").toLowerCase().includes("assigned_emails")) {
      const { data: assignmentBySingle, error: singleError } = await sb
        .from("gig_assignments")
        .select("id, assigned_email, subject_filter")
        .ilike("assigned_email", toEmail)
        .maybeSingle();
      if (singleError) {
        return NextResponse.json(
          { error: singleError.message },
          { status: 500, headers: NO_STORE_HEADERS }
        );
      }
      assignment = assignmentBySingle;
    } else {
      return NextResponse.json(
        { error: listError.message },
        { status: 500, headers: NO_STORE_HEADERS }
      );
    }

    if (!assignment?.id) {
      return NextResponse.json(
        { error: "Assignment not found for recipient" },
        { status: 404, headers: NO_STORE_HEADERS }
      );
    }

    const subject = normalizeText(parsed.subject || body?.subject) || "Verification";
    const plainText = normalizeText(parsed.text);
    const htmlText = parsed.html ? stripHtml(String(parsed.html)) : "";
    const textFromRaw = extractBodyFromRaw(raw);
    const bodyFull =
      plainText ||
      normalizeText(htmlText) ||
      normalizeText(textFromRaw) ||
      raw;

    // NOTE: Do not skip messages by subject filter; store all inbound mail.

    const messageId =
      normalizeText(parsed.messageId) ||
      createHash("sha1").update(raw).digest("hex");

    const { data: existing } = await sb
      .from("gig_inbox")
      .select("id")
      .eq("assignment_id", assignment.id)
      .eq("message_id", messageId)
      .maybeSingle();

    if (existing?.id) {
      return NextResponse.json(
        { ok: true, deduped: true },
        { headers: NO_STORE_HEADERS }
      );
    }

    const createdAt =
      parsed.date instanceof Date ? parsed.date.toISOString() : new Date().toISOString();
    const otp = extractOtp(bodyFull);
    const storedBody = bodyFull ? clampText(bodyFull, 20000) : "(No message body)";

    const { data: inserted, error: insertError } = await sb
      .from("gig_inbox")
      .insert({
        assignment_id: assignment.id,
        to_email: toEmail,
        subject,
        body: storedBody,
        otp_code: otp,
        message_id: messageId,
        created_at: createdAt,
      })
      .select("*")
      .single();

    if (insertError) {
      return NextResponse.json(
        { error: insertError.message },
        { status: 500, headers: NO_STORE_HEADERS }
      );
    }

    return NextResponse.json(
      { ok: true, insertedId: inserted?.id },
      { headers: NO_STORE_HEADERS }
    );
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Ingest failed" },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }
}
