"use client";

import { useState } from "react";
import { cx, getInitials } from "./dashboardUi";
import { usableLogoUrl } from "@/lib/gigLogo";

/**
 * A company's logo in the tile it's shown in, or its initials when the team hasn't added a logo (or it fails to
 * load). `className` sizes and shapes the tile, and styles the initials.
 */
export default function CompanyLogo({ company, logo, className }: { company?: string | null; logo?: string | null; className?: string }) {
  const src = usableLogoUrl(logo);
  const [failed, setFailed] = useState<string | null>(null);
  const showLogo = !!src && failed !== src;
  return (
    <span
      aria-hidden="true"
      className={cx("relative shrink-0 overflow-hidden", className)}
      style={showLogo ? { backgroundColor: "#ffffff" } : undefined}
    >
      {showLogo ? (
        // eslint-disable-next-line @next/next/no-img-element -- logos come from the team's uploads on any host
        <img
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          onError={() => setFailed(src)}
          // An image that failed before hydration never fires onError; catch it when it mounts.
          ref={(node) => { if (node?.complete && node.naturalWidth === 0) setFailed(src); }}
          className="absolute inset-0 h-full w-full object-contain p-[14%]"
        />
      ) : (
        getInitials(company || "?")
      )}
    </span>
  );
}
