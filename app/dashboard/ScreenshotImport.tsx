"use client";

import { apiFetch as fetch } from "@/lib/api/client";
import { useEffect, useId, useRef, useState } from "react";
import { formatCompact } from "@/lib/socialAnalytics";
import { Button, Icon as UiIcon, cx } from "./dashboardUi";

// Upload insight screenshots; the AI screenshot reader turns them into stats. Works for any platform without
// connecting an API: it reads what the account holder sees on their own screen.

const MAX_FILES = 6;
const MAX_EDGE = 2200;

type Reading = {
  handle?: string;
  account: Record<string, number | undefined>;
  reels: Record<string, number | string | undefined>[];
  confidence: number;
  warnings: string[];
};
type Result = { reading: Reading; updatedPostIds: string[]; unmatchedReels: number; warnings: string[]; snapshot?: unknown };

const ACCOUNT_LABELS: Record<string, string> = {
  followers: "Followers",
  following: "Following",
  posts: "Posts",
  reach: "Accounts reached",
  impressions: "Views",
  profileViews: "Profile visits",
  engagements: "Interactions",
  linkClicks: "Link taps",
};

/** Downscale very large screenshots in the browser: keeps uploads small while numbers stay legible. */
async function prepare(file: File): Promise<Blob> {
  if (!file.type.startsWith("image/")) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.size < 2.5 * 1024 * 1024) return file;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve) => canvas.toBlob((blob) => resolve(blob ?? file), "image/jpeg", 0.9));
  } catch {
    return file;
  }
}

const STEPS = ["Uploading screenshots", "Reading the numbers", "Checking them against your account", "Saving"];

export default function ScreenshotImport({
  accountId,
  handle,
  platformLabel,
  postId,
  postLabel,
  onDone,
  onCancel,
}: {
  accountId: string;
  handle: string;
  platformLabel: string;
  /** Set when updating one reel's numbers from its insights screen. */
  postId?: string;
  postLabel?: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const uid = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<{ file: File; url: string }[]>([]);
  const [dragging, setDragging] = useState(false);
  const [step, setStep] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  // Thumbnail URLs are released when removed, and all of them when the uploader closes.
  const urlsRef = useRef(new Set<string>());
  useEffect(() => {
    const urls = urlsRef.current;
    return () => urls.forEach((url) => URL.revokeObjectURL(url));
  }, []);

  const add = (list: FileList | File[]) => {
    const images = Array.from(list).filter((f) => f.type.startsWith("image/"));
    if (!images.length) return;
    setError(null);
    setResult(null);
    const limit = postId ? 2 : MAX_FILES;
    setFiles((prev) => {
      const next = [...prev, ...images.map((file) => ({ file, url: URL.createObjectURL(file) }))];
      next.forEach((f) => urlsRef.current.add(f.url));
      next.slice(limit).forEach((f) => URL.revokeObjectURL(f.url));
      return next.slice(0, limit);
    });
  };

  // Paste screenshots straight from the clipboard.
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const pasted = Array.from(event.clipboardData?.files ?? []);
      if (pasted.length) add(pasted);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  });

  const read = async () => {
    if (!files.length || step !== null) return;
    setError(null);
    setStep(0);
    // The request is a single call; the later steps advance on a timer so people see it working.
    const timers = [window.setTimeout(() => setStep(1), 900), window.setTimeout(() => setStep(2), 7000)];
    try {
      const form = new FormData();
      form.set("accountId", accountId);
      if (postId) form.set("postId", postId);
      for (const { file } of files) form.append("screenshots", await prepare(file), file.name.replace(/\.\w+$/, ".jpg"));
      const res = await fetch("/api/social-accounts/screenshots", { method: "POST", body: form });
      const payload = await res.json().catch(() => null);
      if (!res.ok) throw new Error(payload?.error || "The screenshots couldn't be read.");
      setStep(3);
      setResult(payload as Result);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "The screenshots couldn't be read.");
    } finally {
      timers.forEach(window.clearTimeout);
      setStep(null);
    }
  };

  if (result) {
    const account = Object.entries(result.reading.account).filter(([k, v]) => v !== undefined && k !== "periodDays" && ACCOUNT_LABELS[k]);
    return (
      <div role="status" className="rounded-xl border border-[#b9d5c0] bg-[#f4f9f2] p-4">
        <div className="flex items-start gap-2.5">
          <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#2e7d4f] text-white">
            <UiIcon.Check className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[14px] font-semibold text-[#1a201c]">
              {postId ? "Reel numbers updated" : "Stats updated from your screenshots"}
              <span className="ml-1.5 text-[12px] font-medium text-[#5d7466]">{Math.round(result.reading.confidence * 100)}% sure</span>
            </p>
            {account.length ? (
              <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5 min-[480px]:grid-cols-3">
                {account.map(([k, v]) => (
                  <div key={k} className="min-w-0">
                    <dt className="text-[11px] text-[#5d7466]">{ACCOUNT_LABELS[k]}</dt>
                    <dd className="text-[14px] font-semibold tabular-nums text-[#1a201c]">{formatCompact(v as number)}</dd>
                  </div>
                ))}
              </dl>
            ) : null}
            {result.updatedPostIds.length ? (
              <p className="mt-2 text-[12.5px] text-[#3b5a47]">
                {result.updatedPostIds.length} reel{result.updatedPostIds.length === 1 ? "" : "s"} updated.
              </p>
            ) : null}
            {result.warnings.length ? (
              <ul className="mt-2 space-y-1">
                {result.warnings.map((w) => (
                  <li key={w} className="text-[12px] leading-5 text-[#7a5a13]">
                    • {w}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </div>
        <div className="mt-3 flex justify-end">
          <Button size="sm" onClick={onCancel}>
            Done
          </Button>
        </div>
      </div>
    );
  }

  const busy = step !== null;
  return (
    <div className="rounded-xl border border-[#d9e4dc] bg-white p-3.5 sm:p-4">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
        <p className="text-[14px] font-semibold text-[#1a201c]">{postId ? `Update “${postLabel || "this reel"}” from a screenshot` : "Update stats from screenshots"}</p>
        <p className="text-[11.5px] text-[#7a827c]">Read by AI from your screen. Nothing logs in to your account.</p>
      </div>

      {!postId ? (
        <ul className="mt-2.5 flex flex-wrap gap-1.5 text-[11.5px]">
          {["Profile (followers)", "Professional dashboard → Account insights", "Any reel → View insights"].map((tip) => (
            <li key={tip} className="rounded-full bg-[#f1f3f0] px-2.5 py-1 font-medium text-[#4b544e]">
              {tip}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-1.5 text-[12px] text-[#616a64]">On the reel, tap ••• → View insights, then screenshot the numbers.</p>
      )}

      <label
        htmlFor={`${uid}-files`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          add(e.dataTransfer.files);
        }}
        className={cx(
          "mt-3 flex cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed px-4 py-6 text-center transition",
          dragging ? "border-[#2e7d4f] bg-[#f1f8ef]" : "border-[#d9ddd8] bg-[#fafbf9] hover:border-[#b9c7bd]",
          busy && "pointer-events-none opacity-60"
        )}
      >
        <UiIcon.Video className="h-6 w-6 text-[#2b5d4a]" />
        <span className="text-[13px] font-semibold text-[#1a201c]">Tap to choose screenshots</span>
        <span className="text-[11.5px] text-[#7a827c]">
          or drag them here, or paste · up to {postId ? 2 : MAX_FILES} · PNG, JPEG, WebP
        </span>
        <input
          ref={inputRef}
          id={`${uid}-files`}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          multiple
          className="sr-only"
          onChange={(e) => {
            if (e.target.files) add(e.target.files);
            e.target.value = "";
          }}
        />
      </label>

      {files.length ? (
        <ul className="mt-3 flex gap-2 overflow-x-auto pb-1" aria-label="Selected screenshots">
          {files.map(({ file, url }, index) => (
            <li key={url} className="relative h-28 w-16 shrink-0 overflow-hidden rounded-lg border border-[#e3e5e1] bg-[#f1f3f0] sm:h-32 sm:w-[4.5rem]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={url} alt={`Screenshot ${index + 1}: ${file.name}`} className="h-full w-full object-cover object-top" />
              {!busy ? (
                <button
                  type="button"
                  onClick={() => {
                    URL.revokeObjectURL(url);
                    urlsRef.current.delete(url);
                    setFiles((prev) => prev.filter((_, i) => i !== index));
                  }}
                  aria-label={`Remove screenshot ${index + 1}`}
                  className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-white"
                >
                  <UiIcon.Close className="h-3 w-3" />
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {busy ? (
        <ol className="mt-3 space-y-1.5" aria-live="polite">
          {STEPS.map((label, i) => (
            <li key={label} className={cx("flex items-center gap-2 text-[12.5px]", i <= (step ?? 0) ? "text-[#1a201c]" : "text-[#9aa29c]")}>
              {i < (step ?? 0) ? (
                <UiIcon.Check className="h-3.5 w-3.5 text-[#2e7d4f]" />
              ) : i === step ? (
                <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-[#2e7d4f]/25 border-t-[#2e7d4f]" aria-hidden="true" />
              ) : (
                <span className="h-3.5 w-3.5 rounded-full border border-[#d9ddd8]" aria-hidden="true" />
              )}
              {label}
            </li>
          ))}
        </ol>
      ) : null}

      {error ? (
        <p role="alert" className="mt-3 rounded-lg border border-[#f3cdc8] bg-[#fdf2f1] px-3 py-2 text-[12.5px] text-[#8e1f1a]">
          {error}
        </p>
      ) : null}

      <div className="mt-3.5 flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-[11.5px] text-[#8a928c]">Screenshots must show @{handle} on {platformLabel}. They&apos;re read once and not stored.</p>
        <div className="flex flex-col-reverse gap-2 sm:flex-row">
          <Button className="w-full sm:w-auto" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" className="w-full sm:w-auto" onClick={() => void read()} disabled={!files.length || busy}>
            {busy ? "Reading…" : `Read ${files.length || ""} screenshot${files.length === 1 ? "" : "s"}`.replace("  ", " ")}
          </Button>
        </div>
      </div>
    </div>
  );
}
