"use client";

import { useEffect, useRef, useState, type DragEvent } from "react";
import {
  MAX_GIG_SAMPLES,
  MAX_SAMPLE_CAPTION,
  MAX_SAMPLE_SECONDS,
  formatSampleDuration,
  isSafeMediaUrl,
  sampleIsVertical,
  type GigSample,
} from "@/lib/gigSamples";

const MAX_BYTES = 50 * 1024 * 1024;
const VIDEO_TYPES = ["video/mp4", "video/webm", "video/quicktime"];

type Pending = { id: string; name: string; progress: number; stage: "reading" | "uploading" | "poster" | "error"; error?: string };

/** Reads duration/size from a video and grabs a poster frame (JPEG) a moment in, entirely in the browser. */
function inspectVideo(file: File): Promise<{ duration: number; width: number; height: number; poster: Blob | null }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;
    video.playsInline = true;
    const cleanup = () => URL.revokeObjectURL(url);
    video.onerror = () => {
      cleanup();
      reject(new Error("This video couldn't be read. Try MP4 (H.264)."));
    };
    video.onloadedmetadata = () => {
      video.currentTime = Math.min(0.6, (video.duration || 1) / 3);
    };
    video.onseeked = () => {
      const { videoWidth: width, videoHeight: height, duration } = video;
      const canvas = document.createElement("canvas");
      const scale = Math.min(1, 720 / Math.max(width, height));
      canvas.width = Math.round(width * scale);
      canvas.height = Math.round(height * scale);
      canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(
        (blob) => {
          cleanup();
          resolve({ duration, width, height, poster: blob });
        },
        "image/jpeg",
        0.82
      );
    };
    video.src = url;
  });
}

/** POSTs with upload progress (fetch can't report it). */
function uploadWithProgress(file: Blob, name: string, purpose: "sample" | "sample-poster", token: string, onProgress: (ratio: number) => void) {
  return new Promise<string>((resolve, reject) => {
    const form = new FormData();
    form.append("file", file, name);
    form.append("purpose", purpose);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/admin/gig-brief-media/upload");
    xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total);
    };
    xhr.onload = () => {
      let body: { url?: string; error?: string } = {};
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        // fall through
      }
      if (xhr.status >= 200 && xhr.status < 300 && body.url) resolve(body.url);
      else reject(new Error(body.error || `Upload failed (${xhr.status}).`));
    };
    xhr.onerror = () => reject(new Error("Network error while uploading."));
    xhr.send(form);
  });
}

export function GigSampleVideosField({
  samples,
  onChange,
  getToken,
  onBusyChange,
}: {
  samples: GigSample[];
  onChange: (next: GigSample[] | ((prev: GigSample[]) => GigSample[])) => void;
  getToken: () => Promise<string>;
  onBusyChange?: (busy: boolean) => void;
}) {
  const [pending, setPending] = useState<Pending[]>([]);
  const [dragging, setDragging] = useState(false);
  const [urlDraft, setUrlDraft] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const busy = pending.some((p) => p.stage !== "error");
  const slotsLeft = MAX_GIG_SAMPLES - samples.length - pending.filter((p) => p.stage !== "error").length;

  useEffect(() => {
    onBusyChange?.(busy);
  }, [busy, onBusyChange]);

  const patch = (id: string, next: Partial<Pending>) => setPending((list) => list.map((p) => (p.id === id ? { ...p, ...next } : p)));

  const addFiles = async (files: File[]) => {
    setNotice(null);
    const accepted = files.slice(0, Math.max(0, slotsLeft));
    if (files.length > accepted.length) setNotice(`Only ${MAX_GIG_SAMPLES} samples per gig; ${files.length - accepted.length} file(s) skipped.`);
    let token: string;
    try {
      token = await getToken();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Admin session missing. Please log in again.");
      return;
    }
    await Promise.all(
      accepted.map(async (file) => {
        const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        setPending((list) => [...list, { id, name: file.name, progress: 0, stage: "reading" }]);
        try {
          if (!VIDEO_TYPES.includes(file.type)) throw new Error("Use an MP4, WebM or MOV video.");
          if (file.size > MAX_BYTES) throw new Error("Videos must be 50 MB or smaller.");
          const meta = await inspectVideo(file);
          if (meta.duration > MAX_SAMPLE_SECONDS + 0.5) throw new Error(`Keep samples under ${MAX_SAMPLE_SECONDS} seconds (this one is ${formatSampleDuration(meta.duration)}).`);
          patch(id, { stage: "uploading" });
          const url = await uploadWithProgress(file, file.name, "sample", token, (ratio) => patch(id, { progress: ratio * 0.92 }));
          let poster: string | undefined;
          if (meta.poster) {
            patch(id, { stage: "poster" });
            poster = await uploadWithProgress(meta.poster, `${file.name.replace(/\.[^.]+$/, "")}-poster.jpg`, "sample-poster", token, () => undefined).catch(() => undefined);
          }
          onChange((prev) => [
            ...prev,
            { url, poster, duration: Math.round(meta.duration * 10) / 10, width: meta.width, height: meta.height, caption: file.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").slice(0, MAX_SAMPLE_CAPTION) },
          ]);
          setPending((list) => list.filter((p) => p.id !== id));
        } catch (error) {
          patch(id, { stage: "error", error: error instanceof Error ? error.message : "Upload failed." });
        }
      })
    );
  };

  const addUrl = () => {
    const value = urlDraft.trim();
    if (!isSafeMediaUrl(value)) {
      setNotice("Paste a full https:// link to a video file.");
      return;
    }
    if (samples.some((s) => s.url === value)) {
      setNotice("That video is already in the list.");
      return;
    }
    if (slotsLeft <= 0) {
      setNotice(`Only ${MAX_GIG_SAMPLES} samples per gig.`);
      return;
    }
    // Read duration/size if the browser can; posters need CORS, so linked videos show their first frame instead.
    const video = document.createElement("video");
    video.preload = "metadata";
    video.onloadedmetadata = () =>
      onChange((prev) => prev.map((s) => (s.url === value ? { ...s, duration: Math.round(video.duration * 10) / 10, width: video.videoWidth, height: video.videoHeight } : s)));
    video.src = value;
    onChange((prev) => [...prev, { url: value }]);
    setUrlDraft("");
    setNotice(null);
  };

  const move = (index: number, delta: number) =>
    onChange((prev) => {
      const next = [...prev];
      const target = index + delta;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    void addFiles(Array.from(event.dataTransfer.files ?? []));
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 sm:p-4 md:col-span-2">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="text-xs font-semibold text-slate-700">Sample videos</div>
          <p className="mt-0.5 text-[11px] text-slate-500">
            Short examples of the work you want (≤ {MAX_SAMPLE_SECONDS}s each). Shown to every creator above &ldquo;About this gig&rdquo;.
          </p>
        </div>
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-slate-600">
          {samples.length}/{MAX_GIG_SAMPLES}
        </span>
      </div>

      {/* Drop zone */}
      {slotsLeft > 0 ? (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={`mt-3 flex w-full flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed px-4 py-5 text-center transition ${
            dragging ? "border-[#2f6655] bg-[#edf5ef]" : "border-slate-300 bg-slate-50 hover:border-[#2f6655]/60 hover:bg-[#f4f9f5]"
          }`}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6 text-[#2f6655]" aria-hidden>
            <rect x="3" y="5" width="13" height="14" rx="2.5" />
            <path d="m16 10 5-3v10l-5-3" />
          </svg>
          <span className="text-xs font-semibold text-slate-700">Drop videos here or click to choose</span>
          <span className="text-[11px] text-slate-500">MP4, WebM or MOV · up to 50 MB · vertical 9:16 looks best</span>
        </button>
      ) : null}
      <input
        ref={inputRef}
        type="file"
        accept={VIDEO_TYPES.join(",")}
        multiple
        className="hidden"
        onChange={(event) => {
          const files = Array.from(event.currentTarget.files ?? []);
          event.currentTarget.value = "";
          void addFiles(files);
        }}
      />

      {/* Add by link */}
      <div className="mt-2 flex gap-2">
        <input
          type="url"
          value={urlDraft}
          onChange={(event) => setUrlDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              addUrl();
            }
          }}
          placeholder="…or paste a video link (https://…mp4)"
          className="min-w-0 flex-1 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-900"
          disabled={slotsLeft <= 0}
        />
        <button type="button" onClick={addUrl} disabled={!urlDraft.trim() || slotsLeft <= 0} className="shrink-0 rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:border-slate-400 disabled:opacity-50">
          Add link
        </button>
      </div>

      {notice ? <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] font-semibold text-amber-800">{notice}</div> : null}

      {/* In-flight uploads */}
      {pending.length ? (
        <ul className="mt-3 space-y-1.5" aria-live="polite">
          {pending.map((item) => (
            <li key={item.id} className={`rounded-lg border px-3 py-2 text-[11px] ${item.stage === "error" ? "border-rose-200 bg-rose-50 text-rose-700" : "border-slate-200 bg-slate-50 text-slate-600"}`}>
              <div className="flex items-center justify-between gap-2">
                <span className="truncate font-semibold">{item.name}</span>
                {item.stage === "error" ? (
                  <button type="button" onClick={() => setPending((list) => list.filter((p) => p.id !== item.id))} className="shrink-0 font-semibold underline">
                    Dismiss
                  </button>
                ) : (
                  <span className="shrink-0 tabular-nums">
                    {item.stage === "reading" ? "Reading…" : item.stage === "poster" ? "Saving preview…" : `${Math.round(item.progress * 100)}%`}
                  </span>
                )}
              </div>
              {item.stage === "error" ? (
                <div className="mt-0.5">{item.error}</div>
              ) : (
                <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-slate-200">
                  <div className="h-full rounded-full bg-[#2f6655] transition-[width] duration-300" style={{ width: `${Math.max(4, item.progress * 100)}%` }} />
                </div>
              )}
            </li>
          ))}
        </ul>
      ) : null}

      {/* Samples */}
      {samples.length ? (
        <ol className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {samples.map((sample, index) => (
            <li key={sample.url} className="overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
              <div className={`relative bg-slate-900 ${sampleIsVertical(sample) ? "aspect-[9/16]" : "aspect-video"}`}>
                <video src={`${sample.url}#t=0.5`} poster={sample.poster} preload="metadata" muted playsInline controls className="absolute inset-0 h-full w-full object-cover" />
                <span className="pointer-events-none absolute left-1.5 top-1.5 rounded-full bg-black/60 px-1.5 text-[10px] font-bold text-white">#{index + 1}</span>
                {sample.duration ? <span className="pointer-events-none absolute right-1.5 top-1.5 rounded-full bg-black/60 px-1.5 text-[10px] font-bold tabular-nums text-white">{formatSampleDuration(sample.duration)}</span> : null}
              </div>
              <div className="space-y-1.5 p-2">
                <input
                  value={sample.caption ?? ""}
                  maxLength={MAX_SAMPLE_CAPTION}
                  onChange={(event) => onChange((prev) => prev.map((s, i) => (i === index ? { ...s, caption: event.target.value } : s)))}
                  placeholder="Caption (optional)"
                  aria-label={`Caption for sample ${index + 1}`}
                  className="w-full rounded border border-slate-300 bg-white px-2 py-1 text-[11px] text-slate-900"
                />
                <div className="flex items-center gap-1">
                  <button type="button" onClick={() => move(index, -1)} disabled={index === 0} aria-label="Move earlier" className="rounded border border-slate-300 px-1.5 py-0.5 text-[11px] font-semibold text-slate-600 disabled:opacity-40">
                    ←
                  </button>
                  <button type="button" onClick={() => move(index, 1)} disabled={index === samples.length - 1} aria-label="Move later" className="rounded border border-slate-300 px-1.5 py-0.5 text-[11px] font-semibold text-slate-600 disabled:opacity-40">
                    →
                  </button>
                  <button type="button" onClick={() => onChange((prev) => prev.filter((_, i) => i !== index))} className="ml-auto rounded border border-rose-200 px-2 py-0.5 text-[11px] font-semibold text-rose-700 hover:bg-rose-50">
                    Remove
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ol>
      ) : !pending.length ? (
        <div className="mt-3 rounded-lg border border-dashed border-slate-200 px-3 py-2 text-[11px] text-slate-500">No sample videos yet. Gigs with samples get clearer, closer-to-brief submissions.</div>
      ) : null}
    </div>
  );
}
