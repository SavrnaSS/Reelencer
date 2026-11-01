"use client";

import { useId, useRef, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { apiFetch as fetch } from "@/lib/api/client";
import { usableLogoUrl } from "@/lib/gigLogo";
import { getInitials } from "@/app/dashboard/dashboardUi";

const ACCEPT = ["image/png", "image/jpeg", "image/webp"];
const MAX_BYTES = 2 * 1024 * 1024;

/**
 * The company logo for a gig: upload, replace or remove it. Creators see it on the gig's cards and pages; without
 * one they see the company's initials, as in the preview tile here.
 */
export function CompanyLogoField({ company, value, onChange, onUploadingChange }: {
  company: string;
  value: string;
  onChange: (url: string) => void;
  onUploadingChange?: (uploading: boolean) => void;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [broken, setBroken] = useState<string | null>(null);
  const logo = usableLogoUrl(value);
  const showLogo = !!logo && broken !== logo;

  const upload = async (file: File | undefined) => {
    if (!file || uploading) return;
    setError(null);
    if (!ACCEPT.includes(file.type)) return setError("Use a PNG, JPG or WebP image.");
    if (file.size > MAX_BYTES) return setError("Logos can be up to 2 MB.");
    setUploading(true);
    onUploadingChange?.(true);
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error("Your admin session expired. Sign in again.");
      const body = new FormData();
      body.append("file", file);
      body.append("purpose", "logo");
      const res = await fetch("/api/admin/gig-brief-media/upload", { method: "POST", headers: { Authorization: `Bearer ${token}` }, body });
      const payload = await res.json().catch(() => ({}));
      const url = usableLogoUrl(payload?.url);
      if (!res.ok || !url) throw new Error(payload?.error || "The logo couldn't be uploaded.");
      onChange(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The logo couldn't be uploaded.");
    } finally {
      setUploading(false);
      onUploadingChange?.(false);
      if (input.current) input.current.value = "";
    }
  };

  return (
    <div className="@container min-w-0 sm:col-span-2">
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <span id={`${id}-label`} className="text-[12.5px] font-semibold text-slate-700">Company logo</span>
        <span className="text-[11.5px] text-slate-400">Optional</span>
      </div>
      <div
        onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => { event.preventDefault(); setDragging(false); void upload(event.dataTransfer.files?.[0]); }}
        className={`flex flex-col gap-3 rounded-2xl border p-3 transition @lg:flex-row @lg:items-center @lg:gap-4 ${dragging ? "border-[#2e7d4f] bg-[#f3f8f4] ring-2 ring-[#2e7d4f]/15" : "border-dashed border-slate-300 bg-slate-50/60"}`}
      >
        <div className="flex min-w-0 items-center gap-3 @lg:contents">
          {/* What creators see: the logo, or the initials when there isn't one */}
          <span className="relative grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-xl border border-[#e3e5e1] bg-[#fafbf9] text-[20px] font-bold text-[#2b5d4a]" aria-hidden="true">
            {showLogo ? (
              // eslint-disable-next-line @next/next/no-img-element -- admin preview of an uploaded file
              <img src={logo} alt="" onError={() => setBroken(logo)} ref={(node) => { if (node?.complete && node.naturalWidth === 0) setBroken(logo); }} className="absolute inset-0 h-full w-full bg-white object-contain p-[14%]" />
            ) : (
              getInitials(company || "?")
            )}
            {uploading ? (
              <span className="absolute inset-0 grid place-items-center bg-white/80">
                <span className="h-5 w-5 animate-spin rounded-full border-2 border-[#2e7d4f] border-t-transparent motion-reduce:animate-none" />
              </span>
            ) : null}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-semibold text-slate-900">
              {uploading ? "Uploading logo…" : showLogo ? "Logo added" : "No logo yet"}
            </p>
            <p className="mt-0.5 text-[12px] leading-5 text-slate-500">
              {showLogo
                ? "Shown on the gig's cards and pages."
                : logo && broken === logo
                  ? "This logo couldn't load. Upload it again."
                  : "Creators see the company's initials until you add one. Square PNG, JPG or WebP, up to 2 MB."}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          <input
            ref={input}
            id={`${id}-file`}
            type="file"
            accept={ACCEPT.join(",")}
            className="sr-only"
            aria-labelledby={`${id}-label`}
            onChange={(event) => void upload(event.target.files?.[0])}
          />
          <button
            type="button"
            onClick={() => input.current?.click()}
            disabled={uploading}
            className="inline-flex h-9 flex-1 items-center justify-center rounded-xl bg-[#1f2b24] px-4 text-[13px] font-semibold text-white transition hover:bg-[#2b3a31] disabled:opacity-60 @lg:flex-none"
          >
            {showLogo ? "Replace" : "Upload logo"}
          </button>
          {logo ? (
            <button
              type="button"
              onClick={() => { setError(null); onChange(""); }}
              disabled={uploading}
              className="inline-flex h-9 items-center justify-center rounded-xl border border-slate-300 bg-white px-3.5 text-[13px] font-semibold text-slate-700 transition hover:border-slate-400 disabled:opacity-60"
            >
              Remove
            </button>
          ) : null}
        </div>
      </div>
      {error ? <p role="alert" className="mt-1.5 text-[12px] font-medium text-rose-700">{error}</p> : null}
    </div>
  );
}
