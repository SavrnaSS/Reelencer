"use client";

import { useState } from "react";
import { DEFAULT_REEL_KIT, MAX_KIT_CAPTION, MAX_KIT_STEPS, demoWalletHref, sanitizeReelKit, type ReelKit } from "@/lib/reelKit";

type Draft = Record<"approved" | "approvedReels" | "pending" | "pendingReels" | "paidOut" | "pendingWithdrawal" | "caption" | "steps", string>;

const FIGURES: Array<{ key: keyof Draft; label: string; hint: string; money?: boolean }> = [
  { key: "approved", label: "Approved earnings", hint: "Reel earnings card", money: true },
  { key: "approvedReels", label: "Approved reels", hint: "Under approved earnings" },
  { key: "pending", label: "Pending earnings", hint: "Reel earnings card", money: true },
  { key: "pendingReels", label: "Reels in review", hint: "Under pending earnings" },
  { key: "paidOut", label: "Paid out", hint: "Split over 3 paid cycles", money: true },
  { key: "pendingWithdrawal", label: "Pending withdrawal", hint: "Ends the take as the payout alert", money: true },
];

const toDraft = (kit: ReelKit | null): Draft => {
  const value = kit ?? DEFAULT_REEL_KIT;
  return {
    approved: String(value.approved), approvedReels: String(value.approvedReels),
    pending: String(value.pending), pendingReels: String(value.pendingReels),
    paidOut: String(value.paidOut), pendingWithdrawal: String(value.pendingWithdrawal),
    caption: value.caption, steps: value.steps.join("\n"),
  };
};

const isVideoUrl = (url: string) => /\.(mp4|m4v|mov|webm|ogv)(?:[?#]|$)/i.test(url);

/**
 * Admin settings for the creator reel kit. Inputs keep their own text (so "12." can be typed) and publish a
 * sanitised kit on every change; a kit replaced from outside (another gig loaded, form reset) resets the inputs.
 */
export default function ReelKitEditor({ kit, onChange, onUploadExample, uploading }: { kit: ReelKit | null; onChange: (kit: ReelKit | null) => void; onUploadExample: (file: File) => Promise<string | null>; uploading: boolean }) {
  const incoming = kit ? JSON.stringify(kit) : "";
  const [seen, setSeen] = useState(incoming);
  const [emitted, setEmitted] = useState(incoming);
  const [draft, setDraft] = useState(() => toDraft(kit));
  if (incoming !== seen) {
    setSeen(incoming);
    if (incoming !== emitted) setDraft(toDraft(kit));
  }

  const publish = (next: ReelKit | null) => {
    setEmitted(next ? JSON.stringify(next) : "");
    onChange(next);
  };
  const update = (key: keyof Draft, value: string) => {
    const nextDraft = { ...draft, [key]: value };
    setDraft(nextDraft);
    publish(sanitizeReelKit({ ...nextDraft, screen: "wallet", steps: nextDraft.steps.split(/\r?\n/), example: kit?.example }));
  };
  const setExample = (example: string | undefined) => {
    if (!kit) return;
    const { example: _previous, ...rest } = kit;
    void _previous;
    publish(sanitizeReelKit(example ? { ...rest, example } : rest));
  };

  return (
    <div className="mt-4 min-w-0 rounded-xl border border-[#cfe3d4] bg-[#f6fbf5] p-3 sm:p-4">
      <label className="flex cursor-pointer items-start gap-3">
        <input
          type="checkbox"
          checked={Boolean(kit)}
          onChange={(event) => {
            if (!event.target.checked) return publish(null);
            setDraft(toDraft(DEFAULT_REEL_KIT));
            publish(DEFAULT_REEL_KIT);
          }}
          className="mt-0.5 h-4 w-4 shrink-0 accent-[#2f6655]"
        />
        <span className="min-w-0">
          <span className="block text-xs font-semibold text-slate-800">Reel kit · demo wallet screen</span>
          <span className="mt-0.5 block text-[11px] leading-4 text-slate-500">
            Approved creators get a ready-to-film wallet screen with these sample figures, the on-screen caption, a shot list and your example reel. The screen is labelled as a demo workspace.
          </span>
        </span>
      </label>

      {kit ? (
        <div className="mt-4 space-y-4">
          <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 lg:grid-cols-3">
            {FIGURES.map((field) => (
              <label key={field.key} className="min-w-0">
                <span className="block text-[11px] font-semibold text-slate-700">{field.label}</span>
                <span className="relative mt-1 block">
                  {field.money ? <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-500">₹</span> : null}
                  <input
                    inputMode={field.money ? "decimal" : "numeric"}
                    value={draft[field.key]}
                    onChange={(event) => update(field.key, event.target.value.replace(field.money ? /[^\d.]/g : /\D/g, ""))}
                    className={`h-10 w-full rounded-lg border border-slate-300 bg-white pr-3 text-sm tabular-nums text-slate-900 outline-none focus:border-[#2f6655] focus:ring-2 focus:ring-[#2f6655]/20 ${field.money ? "pl-7" : "pl-3"}`}
                  />
                </span>
                <span className="mt-0.5 block text-[10.5px] text-slate-500">{field.hint}</span>
              </label>
            ))}
          </div>

          <label className="block min-w-0">
            <span className="flex items-baseline justify-between gap-2 text-[11px] font-semibold text-slate-700">
              On-screen caption
              <span className="font-normal tabular-nums text-slate-400">{draft.caption.length}/{MAX_KIT_CAPTION}</span>
            </span>
            <input
              value={draft.caption}
              maxLength={MAX_KIT_CAPTION}
              onChange={(event) => update("caption", event.target.value)}
              placeholder="Start earning just by posting reels 😱"
              className="mt-1 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-[#2f6655] focus:ring-2 focus:ring-[#2f6655]/20"
            />
            <span className="mt-0.5 block text-[10.5px] text-slate-500">Creators can copy it or download it as a transparent sticker.</span>
          </label>

          <label className="block min-w-0">
            <span className="block text-[11px] font-semibold text-slate-700">Notes for creators <span className="font-normal text-slate-500">· one per line, up to {MAX_KIT_STEPS} (optional)</span></span>
            <textarea
              value={draft.steps}
              rows={4}
              onChange={(event) => update("steps", event.target.value)}
              placeholder={"Wear a plain T-shirt\nSay “link in bio” at the end"}
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm leading-5 text-slate-900 outline-none placeholder:text-slate-400 focus:border-[#2f6655] focus:ring-2 focus:ring-[#2f6655]/20"
            />
            <span className="mt-0.5 block text-[10.5px] text-slate-500">Shown highlighted above the built-in setup steps and the timed storyboard, which every kit includes.</span>
          </label>

          <div className="flex min-w-0 flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-white p-2.5">
            {kit.example ? (
              isVideoUrl(kit.example) ? (
                <video src={`${kit.example}#t=0.5`} preload="metadata" muted playsInline className="h-16 w-9 shrink-0 rounded bg-slate-900 object-cover" />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element -- admin preview of an uploaded file on any media host
                <img src={kit.example} alt="" className="h-16 w-9 shrink-0 rounded bg-slate-100 object-cover" />
              )
            ) : (
              <span className="grid h-16 w-9 shrink-0 place-items-center rounded border border-dashed border-slate-300 text-[10px] text-slate-400">9:16</span>
            )}
            <div className="min-w-0 flex-1">
              <div className="text-[11.5px] font-semibold text-slate-700">Example reel</div>
              <div className="text-[10.5px] leading-4 text-slate-500">{kit.example ? "Shown beside the steps." : "Optional. Without one, creators see an auto preview built from the screen and caption."}</div>
            </div>
            <label className="inline-flex min-h-9 cursor-pointer items-center rounded-lg border border-[#9cc3ad] bg-[#edf5ef] px-3 text-[11.5px] font-semibold text-[#2f6655] hover:bg-[#e2efe5]">
              {uploading ? "Uploading…" : kit.example ? "Replace" : "Upload"}
              <input
                type="file"
                accept="video/*,image/*"
                className="sr-only"
                disabled={uploading}
                onChange={async (event) => {
                  const input = event.currentTarget;
                  const file = input.files?.[0];
                  input.value = "";
                  if (!file) return;
                  const url = await onUploadExample(file);
                  if (url) setExample(url);
                }}
              />
            </label>
            {kit.example ? <button type="button" onClick={() => setExample(undefined)} className="text-[11.5px] font-semibold text-slate-500 hover:text-rose-700">Remove</button> : null}
          </div>

          <a href={demoWalletHref(kit, "Creator")} target="_blank" rel="noopener" className="inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-[#1f2b24] px-3 text-[12px] font-semibold text-white hover:bg-[#2b3a31]">
            Preview recording screen ↗
          </a>
        </div>
      ) : null}
    </div>
  );
}
