import type { Metadata } from "next";
import { BRAND_ASSETS } from "@/lib/brand";

// Site identity and SEO defaults shared by the root layout, page metadata, robots, sitemap and manifest.

export const SITE_NAME = "Reelencer";
export const SITE_TITLE = "Reelencer | Paid short-form video gigs for creators";
export const SITE_TAGLINE = "Paid reel gigs for creators";
export const SITE_DESCRIPTION =
  "Reelencer connects creators with paid brand gigs for Instagram Reels, YouTube Shorts and more. Browse open briefs, apply in a few taps, get reviewed fast and track every payout in one workspace.";
export const SITE_KEYWORDS = [
  "creator marketplace",
  "paid creator gigs",
  "UGC jobs",
  "Instagram Reels gigs",
  "YouTube Shorts jobs",
  "short-form video jobs",
  "brand campaigns for creators",
  "influencer marketplace India",
  "earn money from reels",
  "creator payouts",
  "Reelencer",
];

function resolveSiteUrl() {
  const candidates = [
    process.env.NEXT_PUBLIC_SITE_URL,
    process.env.APP_URL,
    process.env.NEXT_PUBLIC_APP_URL,
    process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : undefined,
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      const url = new URL(candidate.trim());
      // A localhost URL left in production env would point every canonical and sitemap entry at localhost.
      if (process.env.NODE_ENV === "production" && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(url.hostname)) continue;
      return url.origin;
    } catch {
      // ignore malformed values
    }
  }
  return "https://reelencer.com";
}

/** Canonical origin, without a trailing slash. */
export const SITE_URL = resolveSiteUrl();

export const absoluteUrl = (path = "/") => new URL(path, SITE_URL).href;

/** Metadata for a public, indexable page: title, description, canonical and matching social cards. */
export function publicPageMetadata({ title, description, path, absoluteTitle = false }: { title: string; description: string; path: string; absoluteTitle?: boolean }): Metadata {
  const fullTitle = absoluteTitle ? title : `${title} | ${SITE_NAME}`;
  return {
    title: absoluteTitle ? { absolute: title } : title,
    description,
    alternates: { canonical: path },
    openGraph: {
      type: "website",
      siteName: SITE_NAME,
      locale: "en_IN",
      url: path,
      title: fullTitle,
      description,
      images: [{ url: BRAND_ASSETS.share, width: 1200, height: 630, alt: `${SITE_NAME}: ${SITE_TAGLINE}` }],
    },
    twitter: {
      card: "summary_large_image",
      title: fullTitle,
      description,
      images: [BRAND_ASSETS.share],
    },
  };
}

/** Metadata for signed-in, admin and one-off auth pages: a clear tab title, kept out of search results. */
export function privatePageMetadata(title: string): Metadata {
  return {
    title,
    robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
  };
}

/** Paths that should never appear in search results (also sent as an X-Robots-Tag header in next.config). */
export const PRIVATE_PATHS = [
  "/api",
  "/admin",
  "/addgigs",
  "/dashboard",
  "/payouts",
  "/work-email-creator",
  "/workspace",
  "/post-login",
  "/logout",
  "/proceed",
  "/auth",
  "/reset-password",
];
