import type { AccountPlatform } from "@/lib/accountSetup";

/** Generic platform glyphs (shapes, not brand logos). */
export default function PlatformGlyph({ platform, className = "h-5 w-5" }: { platform: Pick<AccountPlatform, "id">; className?: string }) {
  const common = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, className, "aria-hidden": true };
  switch (platform.id) {
    case "instagram":
      return (
        <svg {...common}>
          <rect x="3.5" y="3.5" width="17" height="17" rx="5" />
          <circle cx="12" cy="12" r="3.8" />
          <circle cx="17.2" cy="6.8" r="0.6" fill="currentColor" />
        </svg>
      );
    case "youtube":
      return (
        <svg {...common}>
          <rect x="2.5" y="5.5" width="19" height="13" rx="4" />
          <path d="m10.2 9.4 4.4 2.6-4.4 2.6z" fill="currentColor" />
        </svg>
      );
    case "tiktok":
      return (
        <svg {...common}>
          <path d="M14 4v10.5a3.5 3.5 0 1 1-3.5-3.5" />
          <path d="M14 4c.4 2.6 2.1 4.2 4.5 4.5" />
        </svg>
      );
    case "x":
      return (
        <svg {...common}>
          <path d="m5 4.5 14 15M19 4.5l-14 15" />
        </svg>
      );
    case "linkedin":
      return (
        <svg {...common}>
          <rect x="3.5" y="3.5" width="17" height="17" rx="3.5" />
          <path d="M8 10.5v5.5M8 7.8v.01M11.5 16v-5.5M11.5 13c0-1.5 1-2.5 2.3-2.5S16 11.5 16 13v3" />
        </svg>
      );
    default:
      return (
        <svg {...common}>
          <circle cx="12" cy="8.5" r="3.5" />
          <path d="M5 19.5c1.2-3.2 3.8-4.8 7-4.8s5.8 1.6 7 4.8" />
        </svg>
      );
  }
}
