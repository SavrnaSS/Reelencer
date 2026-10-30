"use client";

import { useEffect, useRef, useState } from "react";
import { accountPlatformFor } from "@/lib/accountSetup";
import PlatformGlyph from "./PlatformGlyph";

// "Application sent" for a Content Posting gig: the next step is setting up the account, so the sheet opens it
// after a short countdown. The countdown pauses while the tab is hidden and can be stopped with "Stay here".

const cx = (...values: Array<string | false | null | undefined>) => values.filter(Boolean).join(" ");

export default function AccountSetupCountdown({ platform: platformName, seconds = 4, onGo }: { platform?: string; seconds?: number; onGo: () => void }) {
  const platform = accountPlatformFor(platformName);
  const total = seconds * 1000;
  const [elapsed, setElapsed] = useState(0);
  const [stopped, setStopped] = useState(false);
  const goRef = useRef(onGo);
  useEffect(() => {
    goRef.current = onGo;
  }, [onGo]);

  useEffect(() => {
    if (stopped) return;
    let frame = 0;
    let last = performance.now();
    let spent = 0;
    const tick = (now: number) => {
      // Time only counts while the page is visible, so nobody is moved on while looking elsewhere.
      if (!document.hidden) spent += Math.min(now - last, 100);
      last = now;
      setElapsed(spent);
      if (spent >= total) {
        goRef.current();
        return;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [stopped, total]);

  const left = Math.max(0, Math.ceil((total - elapsed) / 1000));
  const progress = Math.min(1, elapsed / total);

  return (
    <section aria-labelledby="account-setup-next-title" className="mt-5 overflow-hidden rounded-xl border border-[#cfe3d4] bg-[#f4f9f2] text-left">
      <div className="flex items-start gap-3 px-3.5 pb-3 pt-3.5 sm:px-4">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-[#1f5131] ring-1 ring-[#cfe3d4]" aria-hidden="true">
          <PlatformGlyph platform={platform} className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[#2e7d4f]">Next step</p>
          <h3 id="account-setup-next-title" className="mt-0.5 text-[14.5px] font-semibold leading-5 text-[#1a201c]">
            Set up your {platform.label} account
          </h3>
          <p className="mt-1 text-[12.5px] leading-5 text-[#4b544e]">Add your code to the bio, then share the username. About 3 minutes.</p>
        </div>
      </div>

      <div className="border-t border-[#dcebdf] bg-white/60 px-3.5 py-2.5 sm:px-4">
        <div
          className="h-1 overflow-hidden rounded-full bg-[#dcebdf]"
          role="progressbar"
          aria-label="Opening account setup"
          aria-valuemin={0}
          aria-valuemax={seconds}
          aria-valuenow={stopped ? 0 : seconds - left}
        >
          <span className={cx("block h-full origin-left rounded-full bg-[#2e7d4f]", stopped && "bg-[#b5c9b8]")} style={{ transform: `scaleX(${stopped ? 0 : progress})` }} />
        </div>
        <div className="mt-2 flex min-h-7 items-center justify-between gap-3 text-[12.5px]">
          <p className="min-w-0 text-[#4b544e]" aria-live="polite">
            {stopped ? (
              "Auto-open paused. Set up whenever you're ready."
            ) : (
              <>
                Opening account setup in <span className="font-semibold tabular-nums text-[#1a201c]">{left}s</span>
              </>
            )}
          </p>
          {!stopped ? (
            <button
              type="button"
              onClick={() => setStopped(true)}
              className="inline-flex h-7 shrink-0 items-center rounded-md px-2 font-semibold text-[#2b5d4a] transition hover:bg-[#e6f1e7] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2e7d4f]/40"
            >
              Stay here
            </button>
          ) : null}
        </div>
      </div>
    </section>
  );
}
