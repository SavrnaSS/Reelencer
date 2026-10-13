"use client";

import Link from "next/link";
import { BrandLogo } from "./BrandLogo";

export function BrandMark({
  compact = false,
  showTagline = true,
  taglineHidden = false,
}: {
  compact?: boolean;
  showTagline?: boolean;
  taglineHidden?: boolean;
}) {
  return (
    <Link href="/" aria-label="Reelencer home" className="rx-brand group flex min-w-0 max-w-[calc(100vw-8rem)] items-center gap-1.5 text-white sm:max-w-full sm:gap-2">
      <BrandLogo
        className={`rx-brand-mark transition-[width,height,transform] duration-300 ease-out motion-safe:group-hover:scale-105 ${
          compact ? "h-10 w-10 sm:h-11 sm:w-11" : "h-11 w-11 sm:h-[3.25rem] sm:w-[3.25rem] lg:h-14 lg:w-14"
        }`}
        sizes={compact ? "(max-width: 640px) 40px, 44px" : "(max-width: 640px) 44px, (max-width: 1024px) 52px, 56px"}
      />
      <div className="min-w-0 leading-none">
        <div
          className={`truncate font-[Georgia,Times_New_Roman,serif] font-bold leading-[0.95] tracking-[-0.01em] text-white transition-[font-size] duration-300 ease-out ${
            compact ? "text-[1.2rem] sm:text-[1.35rem]" : "text-[1.3rem] sm:text-[1.6rem] lg:text-[1.8rem]"
          }`}
        >
          Reelencer
        </div>
        {showTagline && (
          <div
            className={`rx-brand-tagline overflow-hidden truncate text-[0.6rem] font-bold uppercase tracking-[0.2em] text-[#95ea63] transition-all duration-300 ease-out sm:text-[0.66rem] ${
              taglineHidden ? "mt-0 max-h-0 opacity-0" : "mt-1.5 max-h-4 opacity-100"
            }`}
          >
            Built for creators
          </div>
        )}
      </div>
    </Link>
  );
}
