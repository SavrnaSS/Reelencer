"use client";

import { apiFetch as fetch } from "@/lib/api/client";
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { KycStatus } from "@/lib/payoutReadiness";
import { supabase } from "@/lib/supabaseClient";
import { SELFIE_SESSION_MINUTES, isLiveSelfiePath } from "@/lib/kycSelfie";
import { KycRow } from "./KycStatusRow";

// KYC on the Payouts page: a live status row for the readiness checklist and an in-page verification sheet, so
// creators never leave the payout flow. Status changes arrive over the page's private payouts channel.

export type KycProfile = {
  legalName?: string;
  dob?: string;
  phone?: string;
  address?: string;
  idType?: string;
  idNumber?: string;
  idDocPath?: string;
  selfiePath?: string;
};
export type KycState = {
  status: KycStatus;
  reason: string | null;
  submittedAt?: string | null;
  reviewedAt?: string | null;
  profile?: KycProfile | null;
};

const ID_TYPES = ["National ID", "Passport", "Driver License"] as const;
const MAX_UPLOAD_MB = 10;

const when = (value?: string | null) => {
  if (!value) return null;
  const t = Date.parse(value);
  if (!Number.isFinite(t)) return null;
  const minutes = Math.round((Date.now() - t) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(t).toLocaleDateString(undefined, { day: "numeric", month: "short" });
};

async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Your session expired. Sign in again.");
  return { Authorization: `Bearer ${token}` };
}

export { KycRow };

/* ------------------------------------------------------------------ */
/* Verification sheet                                                  */
/* ------------------------------------------------------------------ */

type Upload = { state: "idle" } | { state: "uploading"; name: string } | { state: "done"; name: string; path: string; preview?: string } | { state: "error"; message: string };

function UploadField({
  step,
  label,
  kind,
  accept,
  value,
  onChange,
  error,
}: {
  step: number;
  label: string;
  kind: "id_doc" | "selfie";
  accept: string;
  value: Upload;
  onChange: (next: Upload) => void;
  error?: string;
}) {
  const id = useId();
  const pick = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > MAX_UPLOAD_MB * 1024 * 1024) return onChange({ state: "error", message: `Keep files under ${MAX_UPLOAD_MB} MB.` });
    const preview = file.type.startsWith("image/") ? URL.createObjectURL(file) : undefined;
    onChange({ state: "uploading", name: file.name });
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("kind", kind);
      const res = await fetch("/api/kyc/upload", { method: "POST", headers: await authHeaders(), body: form });
      const payload = await res.json().catch(() => null);
      if (!res.ok || !payload?.path) throw new Error(payload?.error || "Upload failed. Try another photo.");
      onChange({ state: "done", name: file.name, path: String(payload.path), preview });
    } catch (error) {
      if (preview) URL.revokeObjectURL(preview);
      onChange({ state: "error", message: error instanceof Error ? error.message : "Upload failed." });
    }
  };
  const busy = value.state === "uploading";
  const isPdf = value.state === "done" && !value.preview;
  return (
    <PhotoCard
      step={step}
      title={label}
      chip="Photo or PDF"
      status={value.state === "done" ? "done" : busy ? "busy" : value.state === "error" || error ? "error" : "todo"}
      tips={["All four corners visible", "No glare or blur, text readable"]}
      error={value.state === "error" ? value.message : error}
      visual={
        <label htmlFor={id} className={`group/vis relative flex h-full w-full cursor-pointer items-center justify-center ${busy ? "pointer-events-none" : ""}`}>
          {value.state === "done" && value.preview ? (
            // eslint-disable-next-line @next/next/no-img-element -- local object-URL preview
            <img src={value.preview} alt="Your ID" className="h-full w-full object-cover" />
          ) : isPdf ? (
            <span className="flex flex-col items-center gap-1.5 text-[#41695b]">
              <span className="rounded-[8px] bg-white px-2.5 py-3 text-[12px] font-black tracking-wide ring-1 ring-[#dbe3d7]">PDF</span>
              <span className="max-w-[16ch] truncate text-[12px] font-semibold">{value.name}</span>
            </span>
          ) : busy ? (
            <span className="flex flex-col items-center gap-2 text-[12.5px] font-semibold text-[#41695b]">
              <span className="h-7 w-7 animate-spin rounded-full border-[3px] border-[#41695b]/20 border-t-[#41695b]" aria-hidden />
              Uploading…
            </span>
          ) : (
            // ID card guide
            <span className="relative flex aspect-[1.586] w-[72%] items-center gap-[8%] rounded-[10px] border-2 border-dashed border-[#a9bfa2] bg-white/70 px-[7%] transition group-hover/vis:border-[#8db35a]" aria-hidden>
              <span className="aspect-[3/4] w-[26%] rounded-[6px] bg-[#dfe8da]" />
              <span className="flex flex-1 flex-col gap-1.5">
                <span className="h-1.5 w-full rounded-full bg-[#dfe8da]" />
                <span className="h-1.5 w-3/4 rounded-full bg-[#dfe8da]" />
                <span className="h-1.5 w-1/2 rounded-full bg-[#dfe8da]" />
              </span>
            </span>
          )}
        </label>
      }
      action={
        <label
          htmlFor={id}
          className={`inline-flex h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-lg text-[13.5px] font-semibold transition ${
            value.state === "done" ? "border border-[#dfe7dc] bg-white text-[#41695b] hover:bg-[#f4f7f1]" : "bg-[#1f2b24] text-white hover:bg-[#2b3a31]"
          } ${busy ? "pointer-events-none opacity-60" : ""}`}
        >
          <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M10 13.5V4M6 8l4-4 4 4M4 15.5h12" />
          </svg>
          {value.state === "done" ? "Replace" : busy ? "Uploading…" : "Take photo or upload"}
        </label>
      }
      input={
        <input
          id={id}
          type="file"
          accept={accept}
          className="sr-only"
          disabled={busy}
          onChange={(e) => {
            void pick(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      }
    />
  );
}

type CardStatus = "todo" | "busy" | "done" | "error";
const STATUS_CHIP: Record<CardStatus, { text: string; className: string }> = {
  todo: { text: "To do", className: "bg-[#f3f4f1] text-[#6f7d74]" },
  busy: { text: "Working…", className: "bg-[#eef4fb] text-[#1f5fa8]" },
  done: { text: "✓ Done", className: "bg-[#e3f1d6] text-[#2f6a1f]" },
  error: { text: "Needs attention", className: "bg-[#fdecea] text-[#b42318]" },
};

/** One capture card: numbered header, 4:3 visual, two tips, full-width action. Both photo cards share it. */
function PhotoCard({
  step,
  title,
  chip,
  status,
  visual,
  tips,
  action,
  error,
  notice,
  input,
  dark = false,
  className = "",
  dataCamera,
}: {
  step: number;
  title: string;
  chip: string;
  status: CardStatus;
  visual: ReactNode;
  tips: string[];
  action?: ReactNode;
  error?: string;
  notice?: string | null;
  input?: ReactNode;
  dark?: boolean;
  className?: string;
  dataCamera?: string;
}) {
  return (
    <section
      data-camera={dataCamera}
      className={`flex min-w-0 flex-col rounded-xl bg-white p-3 ring-1 transition sm:p-3.5 ${
        status === "done" ? "ring-[#c6e0b0]" : status === "error" ? "ring-[#f0b8b1]" : "ring-[#e3e9df]"
      } ${className}`}
    >
      <header className="flex items-center gap-2.5">
        <span
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[12.5px] font-bold ${
            status === "done" ? "bg-[#8db35a] text-white" : "bg-[#f0f4ec] text-[#41695b]"
          }`}
          aria-hidden
        >
          {status === "done" ? "✓" : step}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14px] font-semibold text-[#20352c]">{title}</span>
          <span className="block text-[11px] font-medium text-[#7a8a80]">{chip}</span>
        </span>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-semibold ${STATUS_CHIP[status].className}`}>{STATUS_CHIP[status].text}</span>
      </header>
      <div className={`relative mt-3 aspect-[4/3] w-full overflow-hidden rounded-lg ${dark ? "bg-[#0f1411]" : "bg-[linear-gradient(160deg,#f6f9f3,#eef3ea)]"}`}>{visual}</div>
      <ul className="mt-3 space-y-1 text-[12px] leading-[1.35] text-[#5f6f65]">
        {tips.map((tip) => (
          <li key={tip} className="flex gap-1.5">
            <span className="text-[#5e8f35]" aria-hidden>
              ✓
            </span>
            {tip}
          </li>
        ))}
      </ul>
      {error ? (
        <p className="mt-2 rounded-[10px] bg-[#fdf2f1] px-2.5 py-1.5 text-[12px] font-semibold text-[#b42318]" role="alert">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="mt-2 rounded-[10px] bg-[#fff8e8] px-2.5 py-1.5 text-[12px] font-semibold text-[#8a5a00]" role="status">
          {notice}
        </p>
      ) : null}
      {action ? <div className="mt-auto pt-3">{action}</div> : null}
      {input}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Live selfie                                                         */
/* ------------------------------------------------------------------ */

type CameraState =
  | { phase: "idle" }
  | { phase: "starting" }
  | { phase: "live"; challenge: string; token: string; expiresAt: number }
  | { phase: "countdown"; challenge: string; token: string; expiresAt: number; n: number }
  | { phase: "review"; challenge: string; token: string; expiresAt: number; blob: Blob; url: string }
  | { phase: "blocked"; title: string; detail: string };

/**
 * Selfie taken with the in-page camera while a random challenge is shown, so reviewers can tell it's live.
 * There's deliberately no file picker; the server also only accepts selfies uploaded with a capture session.
 */
function LiveSelfie({ step, value, onChange, error, className }: { step: number; value: Upload; onChange: (next: Upload) => void; error?: string; className?: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [cam, setCam] = useState<CameraState>({ phase: "idle" });
  const [notice, setNotice] = useState<string | null>(null);

  const stop = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  };
  useEffect(() => stop, []);
  useEffect(() => {
    if ((cam.phase === "live" || cam.phase === "countdown") && videoRef.current && streamRef.current && videoRef.current.srcObject !== streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
      void videoRef.current.play().catch(() => undefined);
    }
  }, [cam.phase]);

  const start = async () => {
    setNotice(null);
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setCam({ phase: "blocked", title: "Camera not available here", detail: "Open Reelencer in Chrome or Safari over https (or on your phone) to take the live selfie." });
      return;
    }
    setCam({ phase: "starting" });
    try {
      const [stream, sessionRes] = await Promise.all([
        navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 960 } }, audio: false }),
        fetch("/api/kyc/selfie-session", { method: "POST", headers: await authHeaders() }),
      ]);
      const session = await sessionRes.json().catch(() => null);
      if (!sessionRes.ok || !session?.token) {
        stream.getTracks().forEach((t) => t.stop());
        throw new Error(session?.error || "Couldn't start the camera session.");
      }
      streamRef.current = stream;
      setCam({ phase: "live", challenge: String(session.challenge?.text ?? "Look at the camera"), token: String(session.token), expiresAt: Date.parse(session.expiresAt) || Date.now() + SELFIE_SESSION_MINUTES * 60_000 });
    } catch (error) {
      stop();
      const name = (error as { name?: string })?.name;
      if (name === "NotAllowedError" || name === "SecurityError")
        setCam({ phase: "blocked", title: "Camera access was blocked", detail: "Allow camera access for this site in your browser settings (the camera icon in the address bar), then try again." });
      else if (name === "NotFoundError" || name === "OverconstrainedError")
        setCam({ phase: "blocked", title: "No camera found", detail: "Continue on your phone: open Reelencer → Payouts → Verify now. Your other answers are kept in this tab." });
      else if (name === "NotReadableError")
        setCam({ phase: "blocked", title: "Camera is busy", detail: "Close other apps or tabs using the camera, then try again." });
      else setCam({ phase: "blocked", title: "Couldn't open the camera", detail: error instanceof Error ? error.message : "Try again." });
    }
  };

  const capture = () => {
    if (cam.phase !== "live") return;
    const base = { challenge: cam.challenge, token: cam.token, expiresAt: cam.expiresAt };
    // A short countdown leaves time to do the challenge.
    let n = 3;
    setCam({ phase: "countdown", ...base, n });
    const tick = window.setInterval(() => {
      n -= 1;
      if (n > 0) return setCam({ phase: "countdown", ...base, n });
      window.clearInterval(tick);
      const video = videoRef.current;
      if (!video || !video.videoWidth) return setCam({ phase: "live", ...base });
      const scale = Math.min(1, 1280 / Math.max(video.videoWidth, video.videoHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(video.videoWidth * scale);
      canvas.height = Math.round(video.videoHeight * scale);
      const ctx = canvas.getContext("2d");
      if (!ctx) return setCam({ phase: "live", ...base });
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      // Reject near-black frames (covered lens, no light) before they reach the reviewer.
      const sample = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let sum = 0;
      for (let i = 0; i < sample.length; i += 4 * 97) sum += (sample[i] + sample[i + 1] + sample[i + 2]) / 3;
      const brightness = sum / Math.ceil(sample.length / (4 * 97));
      if (brightness < 28) {
        setNotice("That's too dark. Face a light or window and try again.");
        return setCam({ phase: "live", ...base });
      }
      canvas.toBlob(
        (blob) => {
          if (!blob) return setCam({ phase: "live", ...base });
          stop();
          setCam({ phase: "review", ...base, blob, url: URL.createObjectURL(blob) });
        },
        "image/jpeg",
        0.9
      );
    }, 1000);
  };

  const use = async () => {
    if (cam.phase !== "review") return;
    if (cam.expiresAt < Date.now()) {
      setNotice("The camera session expired. Take the selfie again.");
      URL.revokeObjectURL(cam.url);
      return void start();
    }
    const { blob, url, token } = cam;
    onChange({ state: "uploading", name: "Live selfie" });
    try {
      const form = new FormData();
      form.append("file", new File([blob], "live-selfie.jpg", { type: "image/jpeg" }));
      form.append("kind", "selfie");
      form.append("session", token);
      const res = await fetch("/api/kyc/upload", { method: "POST", headers: await authHeaders(), body: form });
      const payload = await res.json().catch(() => null);
      if (!res.ok || !payload?.path) throw new Error(payload?.error || "Upload failed. Take the selfie again.");
      onChange({ state: "done", name: "Live selfie", path: String(payload.path), preview: url });
      setCam({ phase: "idle" });
    } catch (error) {
      onChange({ state: "error", message: error instanceof Error ? error.message : "Upload failed." });
    }
  };
  const retake = () => {
    if (cam.phase === "review") URL.revokeObjectURL(cam.url);
    void start();
  };

  const open = cam.phase === "live" || cam.phase === "countdown";
  const active = open || cam.phase === "review";
  const done = value.state === "done" && cam.phase === "idle";
  const status: CardStatus = done ? "done" : value.state === "uploading" || cam.phase === "starting" ? "busy" : cam.phase === "blocked" || value.state === "error" || error ? "error" : "todo";
  return (
    <PhotoCard
      step={step}
      title="Live selfie"
      chip="Camera only · no gallery photos"
      status={status}
      dark={active}
      dataCamera={active ? "open" : undefined}
      className={className}
      tips={["Face inside the oval, good light", "Do the action shown on screen"]}
      error={value.state === "error" ? value.message : cam.phase === "blocked" ? undefined : error}
      notice={notice}
      visual={
        active ? (
          <>
            {cam.phase === "review" ? (
              // eslint-disable-next-line @next/next/no-img-element -- local capture preview
              <img src={cam.url} alt="Your captured selfie" className="h-full w-full object-cover" />
            ) : (
              <video ref={videoRef} playsInline muted autoPlay className="h-full w-full -scale-x-100 object-cover" aria-label="Camera preview" />
            )}
            {cam.phase !== "review" ? (
              <span className="pointer-events-none absolute left-1/2 top-[50%] h-[66%] w-[42%] -translate-x-1/2 -translate-y-1/2 rounded-[50%] border-[3px] border-dashed border-white/75 shadow-[0_0_0_999px_rgba(15,20,17,0.35)]" aria-hidden />
            ) : null}
            <span className="absolute inset-x-2.5 top-2.5 flex items-center gap-2 rounded-lg bg-white/95 px-2.5 py-1.5 text-[12.5px] font-semibold text-[#20352c] shadow-lg sm:inset-x-3 sm:top-3 sm:px-3 sm:py-2 sm:text-[13px]">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#dce78f] text-[12px]" aria-hidden>
                ✋
              </span>
              <span className="min-w-0">
                <span className="block text-[10px] font-semibold uppercase tracking-[0.08em] text-[#6f7d74]">{cam.phase === "review" ? "Check the photo shows" : "Do this, then capture"}</span>
                <span className="block truncate">{cam.challenge}</span>
              </span>
            </span>
            {cam.phase === "countdown" ? (
              <span className="absolute inset-0 flex items-center justify-center text-[64px] font-bold text-white drop-shadow-[0_4px_16px_rgba(0,0,0,0.5)] sm:text-[72px]" aria-live="assertive">
                {cam.n}
              </span>
            ) : null}
            {open ? (
              <button
                type="button"
                onClick={capture}
                disabled={cam.phase === "countdown"}
                aria-label="Capture selfie"
                className="absolute bottom-3 left-1/2 flex h-14 w-14 -translate-x-1/2 items-center justify-center rounded-full border-4 border-white/90 bg-white/20 backdrop-blur transition active:scale-95 disabled:opacity-60 sm:h-16 sm:w-16"
              >
                <span className="h-9 w-9 rounded-full bg-white sm:h-11 sm:w-11" />
              </button>
            ) : null}
          </>
        ) : done && value.state === "done" && value.preview ? (
          // eslint-disable-next-line @next/next/no-img-element -- local capture preview
          <img src={value.preview} alt="Your live selfie" className="h-full w-full object-cover" />
        ) : (
          <span className="flex h-full w-full flex-col items-center justify-center gap-2 px-4 text-center">
            {cam.phase === "blocked" ? (
              <>
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#fdecea] text-[16px] font-black text-[#b42318]" aria-hidden>
                  !
                </span>
                <span className="text-[13px] font-semibold text-[#8e1f1a]">{cam.title}</span>
                <span className="max-w-[34ch] text-[12px] leading-5 text-[#5f6f65]">{cam.detail}</span>
              </>
            ) : done ? (
              <span className="text-[13px] font-semibold text-[#2f6a1f]">✓ Live selfie on file</span>
            ) : (
              // Face-in-oval guide
              <span className="relative flex h-[72%] aspect-[3/4] items-center justify-center rounded-[50%] border-2 border-dashed border-[#a9bfa2] bg-white/70" aria-hidden>
                <svg viewBox="0 0 40 40" className="h-[58%] w-[58%] text-[#c5d5bf]" fill="currentColor">
                  <circle cx="20" cy="14" r="8" />
                  <path d="M5 38c1.5-8 7.6-12 15-12s13.5 4 15 12z" />
                </svg>
                <span className="absolute -right-2 bottom-[18%] rounded-full bg-[#dce78f] px-1.5 py-0.5 text-[11px] shadow-sm">✋</span>
              </span>
            )}
          </span>
        )
      }
      action={
        cam.phase === "review" ? (
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={retake} disabled={value.state === "uploading"} className="h-11 rounded-lg border border-[#dfe7dc] bg-white text-[13.5px] font-semibold text-[#41695b] transition hover:bg-[#f4f7f1]">
              Retake
            </button>
            <button type="button" onClick={() => void use()} disabled={value.state === "uploading"} className="h-11 rounded-lg bg-[#41695b] text-[13.5px] font-semibold text-white transition hover:bg-[#35584b] disabled:opacity-70">
              {value.state === "uploading" ? "Uploading…" : "Use this photo"}
            </button>
          </div>
        ) : open ? (
          <p className="text-center text-[12px] font-medium text-[#5f6f65]">Tap the shutter. You&apos;ll get a 3-second countdown.</p>
        ) : (
          <button
            type="button"
            onClick={() => (done ? retake() : void start())}
            disabled={cam.phase === "starting"}
            className={`inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg text-[13.5px] font-semibold transition disabled:opacity-70 ${
              done ? "border border-[#dfe7dc] bg-white text-[#41695b] hover:bg-[#f4f7f1]" : "bg-[#1f2b24] text-white hover:bg-[#2b3a31]"
            }`}
          >
            <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden>
              <path d="M3.5 6.5h3l1.5-2h4l1.5 2h3v9h-13zM10 13.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z" />
            </svg>
            {cam.phase === "starting" ? "Opening camera…" : done ? "Retake" : cam.phase === "blocked" ? "Try again" : "Open camera"}
          </button>
        )
      }
    />
  );
}

const inputClass =
  "h-12 w-full rounded-lg border border-[#dbe3d7] bg-white px-4 text-[16px] font-medium text-[#1f2e28] outline-none transition placeholder:font-normal placeholder:text-[#a3b0a7] focus:border-[#8db35a] focus:ring-4 focus:ring-[#dce78f]/40 aria-[invalid=true]:border-[#e8a39b] aria-[invalid=true]:bg-[#fffafa]";

const ID_HINTS: Record<(typeof ID_TYPES)[number], { hint: string; placeholder: string; icon: string }> = {
  "National ID": { hint: "Aadhaar or your country's national ID", placeholder: "e.g. 1234 5678 9012", icon: "M3.5 5h13v10h-13zM6.5 12.5h3M6.5 9.5h5" },
  Passport: { hint: "Photo page of a valid passport", placeholder: "e.g. K1234567", icon: "M5.5 3.5h9v13h-9zM10 11a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM8 13.5h4" },
  "Driver License": { hint: "Front of a valid licence", placeholder: "e.g. MH12 20110012345", icon: "M3.5 6h13v8h-13zM6 9.5h4M6 11.5h2.5M13 9a1.2 1.2 0 1 0 0 .01" },
};

const STEP_META = [
  { key: "about", label: "About you" },
  { key: "id", label: "ID" },
  { key: "photos", label: "Photos" },
  { key: "review", label: "Review" },
] as const;
type StepKey = (typeof STEP_META)[number]["key"];

type Draft = { legalName: string; dobDay: string; dobMonth: string; dobYear: string; phone: string; address: string; idType: string; idNumber: string };
const DRAFT_KEY = "reelencer:kyc-draft:v1";
/** The draft survives closing the sheet (this tab only). The ID number is never written to storage. */
function readDraft(): Partial<Draft> {
  try {
    return JSON.parse(window.sessionStorage.getItem(DRAFT_KEY) ?? "{}") as Partial<Draft>;
  } catch {
    return {};
  }
}
function writeDraft(draft: Draft) {
  try {
    const { idNumber: _omit, ...safe } = draft;
    void _omit;
    window.sessionStorage.setItem(DRAFT_KEY, JSON.stringify(safe));
  } catch {
    /* Storage unavailable: the form still works. */
  }
}
function clearDraft() {
  try {
    window.sessionStorage.removeItem(DRAFT_KEY);
  } catch {
    /* ignore */
  }
}

function FieldShell({ label, hint, error, htmlFor, children, className = "" }: { label: string; hint?: string; error?: string; htmlFor?: string; children: ReactNode; className?: string }) {
  return (
    <div className={`min-w-0 ${className}`}>
      <label htmlFor={htmlFor} className="block text-[13px] font-semibold text-[#274537]">
        {label}
      </label>
      <div className="mt-1.5">{children}</div>
      {error ? <p className="mt-1 text-[12px] font-semibold text-[#b42318]">{error}</p> : hint ? <p className="mt-1 text-[12px] text-[#6f7d74]">{hint}</p> : null}
    </div>
  );
}

export function KycSheet({ kyc, onClose, onSubmitted }: { kyc: KycState; onClose: () => void; onSubmitted: (next: KycState) => void }) {
  const titleId = useId();
  const uid = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);
  const readOnly = kyc.status === "pending" || kyc.status === "approved";
  const p = kyc.profile ?? {};
  const [dobYear0, dobMonth0, dobDay0] = (p.dob ?? "").split("-");
  const [form, setForm] = useState<Draft>(() => ({
    legalName: p.legalName ?? "",
    dobDay: dobDay0 ?? "",
    dobMonth: dobMonth0 ?? "",
    dobYear: dobYear0 ?? "",
    phone: p.phone ?? "",
    address: p.address ?? "",
    idType: p.idType ?? "",
    idNumber: p.idNumber ?? "",
    // A first-time submission picks up where the creator left off (minus the ID number).
    ...(kyc.status === "none" && typeof window !== "undefined" ? readDraft() : {}),
  }));
  const [idDoc, setIdDoc] = useState<Upload>(p.idDocPath ? { state: "done", name: "ID on file", path: p.idDocPath } : { state: "idle" });
  const [selfie, setSelfie] = useState<Upload>(isLiveSelfiePath(p.selfiePath) && p.selfiePath ? { state: "done", name: "Live selfie on file", path: p.selfiePath } : { state: "idle" });
  const [step, setStep] = useState<StepKey>("about");
  const [touched, setTouched] = useState<Record<StepKey, boolean>>({ about: false, id: false, photos: false, review: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeRef.current();
    };
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    panelRef.current?.focus();
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
      opener?.focus();
    };
  }, []);
  useEffect(() => {
    if (!readOnly && kyc.status === "none") writeDraft(form);
  }, [form, readOnly, kyc.status]);
  // Release preview object URLs when the sheet closes.
  useEffect(
    () => () => {
      for (const upload of [idDoc, selfie]) if (upload.state === "done" && upload.preview) URL.revokeObjectURL(upload.preview);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- cleanup on unmount only
    []
  );

  const pad = (v: string) => v.padStart(2, "0");
  const dob = form.dobYear.length === 4 && form.dobMonth && form.dobDay ? `${form.dobYear}-${pad(form.dobMonth)}-${pad(form.dobDay)}` : "";
  const dobDate = dob ? new Date(`${dob}T00:00:00`) : null;
  const dobValid =
    !!dobDate &&
    !Number.isNaN(dobDate.getTime()) &&
    dobDate.getDate() === Number(form.dobDay) &&
    dobDate.getMonth() + 1 === Number(form.dobMonth) &&
    Number(form.dobYear) >= 1900 &&
    dobDate.getTime() < Date.now();

  const errorsByStep: Record<StepKey, Partial<Record<string, string>>> = {
    about: {
      ...(form.legalName.trim().length < 3 ? { legalName: "Enter your full name exactly as on your ID." } : {}),
      ...(!dobValid ? { dob: "Enter a real date of birth (DD / MM / YYYY)." } : {}),
      ...(!/^\+?[\d\s()-]{7,}$/.test(form.phone.trim()) ? { phone: "Enter a phone number we can reach you on." } : {}),
      ...(form.address.trim().length < 8 ? { address: "Enter your full address, including city and PIN code." } : {}),
    },
    id: {
      ...(!form.idType ? { idType: "Choose the ID you'll upload." } : {}),
      ...(form.idNumber.trim().length < 4 ? { idNumber: "Enter the number printed on your ID." } : {}),
    },
    photos: {
      ...(idDoc.state !== "done" ? { idDoc: "Upload a photo of your ID." } : {}),
      ...(selfie.state !== "done" ? { selfie: "Take a live selfie with your camera." } : {}),
    },
    review: {},
  };
  const stepIndex = STEP_META.findIndex((s) => s.key === step);
  const stepDone = (key: StepKey) => Object.keys(errorsByStep[key]).length === 0;
  const err = (key: StepKey, field: string) => (touched[key] ? errorsByStep[key][field] : undefined);
  const uploading = idDoc.state === "uploading" || selfie.state === "uploading";

  const go = (next: StepKey) => {
    setStep(next);
    setError(null);
    requestAnimationFrame(() => bodyRef.current?.scrollTo({ top: 0, behavior: "smooth" }));
  };
  const advance = () => {
    setTouched((t) => ({ ...t, [step]: true }));
    if (!stepDone(step)) return;
    go(STEP_META[stepIndex + 1].key);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (step !== "review") return advance();
    const firstIncomplete = STEP_META.find((s) => !stepDone(s.key));
    if (firstIncomplete) {
      setTouched({ about: true, id: true, photos: true, review: true });
      return go(firstIncomplete.key);
    }
    if (idDoc.state !== "done" || selfie.state !== "done") return;
    setBusy(true);
    setError(null);
    try {
      const details = {
        legalName: form.legalName.trim(),
        dob,
        phone: form.phone.trim(),
        address: form.address.trim(),
        idType: form.idType,
        idNumber: form.idNumber.trim(),
      };
      const res = await fetch("/api/kyc", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify({ ...details, idDocPath: idDoc.path, selfiePath: selfie.path }),
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok) throw new Error(payload?.error || "Submission failed. Try again.");
      clearDraft();
      onSubmitted({ status: "pending", reason: null, submittedAt: payload?.submittedAt ?? new Date().toISOString(), reviewedAt: null, profile: { ...details, idDocPath: idDoc.path, selfiePath: selfie.path } });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Submission failed.");
    } finally {
      setBusy(false);
    }
  };

  const set = (key: keyof Draft) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const digits = (key: "dobDay" | "dobMonth" | "dobYear", max: number, nextId?: string) => (e: { target: { value: string } }) => {
    const value = e.target.value.replace(/\D/g, "").slice(0, max);
    setForm((f) => ({ ...f, [key]: value }));
    // Jump to the next part once this one is full.
    if (value.length === max && nextId) document.getElementById(nextId)?.focus();
  };
  const idMeta = ID_HINTS[form.idType as keyof typeof ID_HINTS];
  const maskedId = form.idNumber.trim() ? `••••${form.idNumber.trim().slice(-4)}` : "—";

  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-end justify-center sm:items-stretch sm:justify-end" role="presentation">
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 bg-[#0f1411]/40 backdrop-blur-[2px]" />
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative flex max-h-[94dvh] w-full flex-col overflow-hidden rounded-t-[22px] bg-[#fcfdf9] text-[#20352c] shadow-[0_-12px_40px_-12px_rgba(15,20,17,0.35)] outline-none sm:h-full sm:max-h-none sm:w-[min(560px,100vw)] sm:rounded-none sm:rounded-l-[22px]"
      >
        <span className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-[#d9ddd8] sm:hidden" aria-hidden />

        {/* Header */}
        <div className="border-b border-[#e6ebe2] px-4 pb-3 pt-3 sm:px-6 sm:pb-4 sm:pt-5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#41695b] text-white" aria-hidden>
                <svg viewBox="0 0 20 20" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.7">
                  <path d="M10 3.5 15.5 5.5v4c0 3.4-2.3 6-5.5 7-3.2-1-5.5-3.6-5.5-7v-4L10 3.5ZM7.5 10l1.8 1.8L12.8 8.3" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
              <div className="min-w-0">
                <h2 id={titleId} className="truncate text-[17px] font-semibold tracking-[-0.01em]">
                  {kyc.status === "pending" ? "KYC in review" : kyc.status === "approved" ? "Identity verified" : kyc.status === "rejected" ? "Fix and resubmit KYC" : "Verify your identity"}
                </h2>
                <p className="text-[12.5px] text-[#5f6f65]">{readOnly ? "The decision appears here the moment it's made." : "Unlocks payouts · about 2 minutes"}</p>
              </div>
            </div>
            <button type="button" onClick={onClose} className="rounded-full p-2 text-[#5f6f65] hover:bg-[#f0f4ec]" aria-label="Close">
              <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                <path d="m6 6 8 8M14 6l-8 8" />
              </svg>
            </button>
          </div>

          {!readOnly ? (
            <ol className="mt-4 grid grid-cols-4 gap-1.5" aria-label="Steps">
              {STEP_META.map((meta, index) => {
                const done = index < stepIndex && stepDone(meta.key);
                const current = meta.key === step;
                const reachable = index <= stepIndex || STEP_META.slice(0, index).every((s) => stepDone(s.key));
                return (
                  <li key={meta.key} className="min-w-0">
                    <button
                      type="button"
                      disabled={!reachable}
                      onClick={() => go(meta.key)}
                      aria-current={current ? "step" : undefined}
                      className="group block w-full text-left disabled:cursor-not-allowed"
                    >
                      <span className={`block h-1.5 rounded-full transition-colors duration-300 ${current ? "bg-[#41695b]" : done ? "bg-[#8db35a]" : "bg-[#e6ebe2]"}`} />
                      <span className={`mt-1.5 flex items-center gap-1 truncate text-[11.5px] ${current ? "font-semibold text-[#20352c]" : done ? "font-medium text-[#4d6a2a]" : "text-[#9aa29c]"}`}>
                        {done ? <span aria-hidden>✓</span> : null}
                        {meta.label}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
          ) : null}
        </div>

        {readOnly ? (
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4 sm:px-6">
            <KycRow kyc={kyc} highlighted={false} live onOpen={onClose} />
            <dl className="grid grid-cols-2 gap-3 rounded-xl bg-white p-4 text-[13px] ring-1 ring-[#e6ebe2]">
              {[
                ["Name", p.legalName],
                ["ID", p.idType ? `${p.idType} · ••••${String(p.idNumber ?? "").slice(-4)}` : null],
                ["Phone", p.phone],
                ["Submitted", when(kyc.submittedAt)],
              ].map(([label, value]) => (
                <div key={label as string} className="min-w-0">
                  <dt className="text-[11.5px] text-[#6f7d74]">{label}</dt>
                  <dd className="truncate font-semibold">{value || "—"}</dd>
                </div>
              ))}
            </dl>
            <p className="text-[12px] text-[#6f7d74]">Reviews usually finish within a day. You can keep earning meanwhile; only payout requests wait for approval.</p>
          </div>
        ) : (
          <form onSubmit={submit} noValidate className="flex min-h-0 flex-1 flex-col">
            <div ref={bodyRef} className="@container/kyc min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6">
              {kyc.status === "rejected" && kyc.reason && step !== "review" ? (
                <p className="mb-4 flex gap-2 rounded-lg border border-[#f6cdc8] bg-[#fdecea] px-3 py-2.5 text-[13px] text-[#8e1f1a]">
                  <span aria-hidden className="font-black">!</span>
                  <span>
                    <span className="font-semibold">What to fix: </span>
                    {kyc.reason}
                  </span>
                </p>
              ) : null}

              {step === "about" ? (
                <div className="space-y-4">
                  <FieldShell label="Full legal name" hint="Exactly as printed on your ID" error={err("about", "legalName")} htmlFor={`${uid}-name`}>
                    <input id={`${uid}-name`} autoFocus className={inputClass} value={form.legalName} onChange={set("legalName")} autoComplete="name" placeholder="e.g. Priya Sharma" aria-invalid={!!err("about", "legalName")} />
                  </FieldShell>
                  <div className="grid gap-4 @[460px]/kyc:grid-cols-2">
                    <div className="min-w-0">
                      <span className="block text-[13px] font-semibold text-[#274537]" id={`${uid}-dob-label`}>
                        Date of birth
                      </span>
                      <div className="mt-1.5 grid grid-cols-[1fr_1fr_1.5fr] gap-2" role="group" aria-labelledby={`${uid}-dob-label`}>
                        {(
                          [
                            ["dobDay", "DD", 2, `${uid}-dob-m`, `${uid}-dob-d`, "Day"],
                            ["dobMonth", "MM", 2, `${uid}-dob-y`, `${uid}-dob-m`, "Month"],
                            ["dobYear", "YYYY", 4, undefined, `${uid}-dob-y`, "Year"],
                          ] as const
                        ).map(([key, placeholder, max, nextId, id, label]) => (
                          <input
                            key={key}
                            id={id}
                            aria-label={label}
                            inputMode="numeric"
                            autoComplete={key === "dobDay" ? "bday-day" : key === "dobMonth" ? "bday-month" : "bday-year"}
                            placeholder={placeholder}
                            value={form[key]}
                            onChange={digits(key, max, nextId)}
                            className={`${inputClass} px-0 text-center tabular-nums`}
                            aria-invalid={!!err("about", "dob")}
                          />
                        ))}
                      </div>
                      {err("about", "dob") ? <p className="mt-1 text-[12px] font-semibold text-[#b42318]">{err("about", "dob")}</p> : null}
                    </div>
                    <FieldShell label="Phone" hint="For review questions only" error={err("about", "phone")} htmlFor={`${uid}-phone`}>
                      <input id={`${uid}-phone`} type="tel" inputMode="tel" autoComplete="tel" placeholder="+91 98765 43210" className={inputClass} value={form.phone} onChange={set("phone")} aria-invalid={!!err("about", "phone")} />
                    </FieldShell>
                  </div>
                  <FieldShell label="Address" hint="House, street, city, state and PIN code" error={err("about", "address")} htmlFor={`${uid}-address`}>
                    <textarea
                      id={`${uid}-address`}
                      rows={2}
                      autoComplete="street-address"
                      placeholder="Flat 4B, Green Park, Andheri West, Mumbai 400058"
                      className={`${inputClass} h-auto min-h-[76px] resize-none py-3 leading-6`}
                      value={form.address}
                      onChange={set("address")}
                      aria-invalid={!!err("about", "address")}
                    />
                  </FieldShell>
                </div>
              ) : step === "id" ? (
                <div className="space-y-4">
                  <fieldset>
                    <legend className="text-[13px] font-semibold text-[#274537]">Which ID will you use?</legend>
                    <div className="mt-2 grid gap-2 @[460px]/kyc:grid-cols-3">
                      {ID_TYPES.map((type) => {
                        const active = form.idType === type;
                        return (
                          <label
                            key={type}
                            className={`flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition has-[:focus-visible]:ring-4 has-[:focus-visible]:ring-[#dce78f]/50 @[460px]/kyc:flex-col @[460px]/kyc:items-start ${
                              active ? "border-[#41695b] bg-[#f3f8ee] ring-1 ring-[#41695b]" : "border-[#dbe3d7] bg-white hover:border-[#b9c9b4]"
                            }`}
                          >
                            <input type="radio" name={`${uid}-idtype`} value={type} checked={active} onChange={set("idType")} className="sr-only" />
                            <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] ${active ? "bg-[#41695b] text-white" : "bg-[#f0f4ec] text-[#41695b]"}`} aria-hidden>
                              <svg viewBox="0 0 20 20" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                                <path d={ID_HINTS[type].icon} />
                              </svg>
                            </span>
                            <span className="min-w-0">
                              <span className="block text-[13.5px] font-semibold">{type}</span>
                              <span className="block text-[11.5px] leading-4 text-[#6f7d74]">{ID_HINTS[type].hint}</span>
                            </span>
                          </label>
                        );
                      })}
                    </div>
                    {err("id", "idType") ? <p className="mt-1 text-[12px] font-semibold text-[#b42318]">{err("id", "idType")}</p> : null}
                  </fieldset>
                  <FieldShell label="ID number" hint="Only the review team sees this." error={err("id", "idNumber")} htmlFor={`${uid}-idnum`}>
                    <input
                      id={`${uid}-idnum`}
                      className={`${inputClass} font-mono tracking-wide`}
                      value={form.idNumber}
                      onChange={set("idNumber")}
                      placeholder={idMeta?.placeholder ?? "Choose an ID type first"}
                      autoComplete="off"
                      autoCapitalize="characters"
                      spellCheck={false}
                      aria-invalid={!!err("id", "idNumber")}
                    />
                  </FieldShell>
                </div>
              ) : step === "photos" ? (
                <div className="space-y-3">
                  <p className="flex items-center justify-between gap-3 text-[12.5px] text-[#5f6f65]">
                    <span>Two quick photos. Stored privately, seen only by the review team.</span>
                    <span className="shrink-0 rounded-full bg-[#f0f4ec] px-2 py-0.5 text-[11.5px] font-semibold tabular-nums text-[#41695b]">
                      {(idDoc.state === "done" ? 1 : 0) + (selfie.state === "done" ? 1 : 0)}/2
                    </span>
                  </p>
                  {/* Side by side in the wide drawer; stacked on phones. The selfie card takes the full row while the camera is open. */}
                  <div className="grid items-stretch gap-3 @[480px]/kyc:grid-cols-2">
                    <UploadField
                      step={1}
                      label={`${form.idType || "ID"} (front)`}
                      kind="id_doc"
                      accept="image/jpeg,image/png,application/pdf"
                      value={idDoc}
                      onChange={setIdDoc}
                      error={idDoc.state !== "error" ? err("photos", "idDoc") : undefined}
                    />
                    <LiveSelfie
                      step={2}
                      value={selfie}
                      onChange={setSelfie}
                      error={selfie.state !== "error" ? err("photos", "selfie") : undefined}
                      className="@[480px]/kyc:data-[camera=open]:col-span-2 @[480px]/kyc:data-[camera=open]:row-start-1"
                    />
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  {(
                    [
                      ["about", "About you", [["Name", form.legalName.trim()], ["Date of birth", dobValid && dobDate ? dobDate.toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" }) : "—"], ["Phone", form.phone.trim()], ["Address", form.address.trim()]]],
                      ["id", "ID", [["Type", form.idType], ["Number", maskedId]]],
                      ["photos", "Photos", [["ID photo", idDoc.state === "done" ? idDoc.name : "Missing"], ["Selfie", selfie.state === "done" ? "Live camera capture" : "Missing"]]],
                    ] as const
                  ).map(([key, title, rows]) => (
                    <section key={key} className="rounded-xl bg-white p-4 ring-1 ring-[#e6ebe2]">
                      <div className="flex items-center justify-between gap-2">
                        <h3 className="flex items-center gap-1.5 text-[13.5px] font-semibold">
                          <span className={stepDone(key) ? "text-[#5e8f35]" : "text-[#b42318]"} aria-hidden>
                            {stepDone(key) ? "✓" : "!"}
                          </span>
                          {title}
                        </h3>
                        <button type="button" onClick={() => go(key)} className="text-[12.5px] font-semibold text-[#41695b] underline-offset-2 hover:underline">
                          Edit
                        </button>
                      </div>
                      <dl className="mt-2 grid gap-x-4 gap-y-1.5 text-[13px] @[460px]/kyc:grid-cols-2">
                        {rows.map(([label, value]) => (
                          <div key={label} className={`min-w-0 ${label === "Address" ? "@[460px]/kyc:col-span-2" : ""}`}>
                            <dt className="text-[11.5px] text-[#6f7d74]">{label}</dt>
                            <dd className="break-words font-medium">{value || "—"}</dd>
                          </div>
                        ))}
                      </dl>
                    </section>
                  ))}
                  <p className="flex gap-2 text-[12px] leading-5 text-[#5f6f65]">
                    <svg viewBox="0 0 20 20" className="mt-0.5 h-4 w-4 shrink-0 text-[#41695b]" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden>
                      <path d="M6.5 9V7a3.5 3.5 0 0 1 7 0v2M5 9h10v7.5H5z" strokeLinejoin="round" />
                    </svg>
                    By submitting you confirm these details are yours and correct. They&apos;re stored privately, used only to verify payouts, and reviewed by the team, usually within a day.
                  </p>
                </div>
              )}

              {error ? (
                <p role="alert" className="mt-4 rounded-lg border border-[#f6cdc8] bg-[#fdecea] px-3 py-2 text-[13px] font-semibold text-[#b42318]">
                  {error}
                </p>
              ) : null}
            </div>

            <div className="flex gap-2 border-t border-[#e6ebe2] bg-white px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-6">
              <button
                type="button"
                onClick={() => (stepIndex === 0 ? onClose() : go(STEP_META[stepIndex - 1].key))}
                disabled={busy}
                className="inline-flex h-12 flex-1 items-center justify-center gap-1.5 rounded-lg border border-[#dfe7dc] bg-white px-4 text-[14px] font-semibold text-[#41695b] transition hover:bg-[#f4f7f1] sm:flex-none sm:px-5"
              >
                {stepIndex === 0 ? "Cancel" : <><span aria-hidden>←</span> Back</>}
              </button>
              <button
                type="submit"
                disabled={busy || uploading}
                className="inline-flex h-12 flex-[2] items-center justify-center gap-1.5 rounded-lg bg-[#41695b] px-5 text-[14px] font-semibold text-white shadow-[0_10px_20px_-12px_rgba(54,88,75,0.9)] transition hover:bg-[#35584b] disabled:opacity-60 sm:ml-auto sm:flex-none sm:min-w-[200px]"
              >
                {busy ? "Submitting…" : uploading ? "Uploading…" : step === "review" ? (kyc.status === "rejected" ? "Resubmit for review" : "Submit for review") : <>Continue <span aria-hidden>→</span></>}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>,
    document.body
  );
}
