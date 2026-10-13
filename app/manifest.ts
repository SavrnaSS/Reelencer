import type { MetadataRoute } from "next";
import { BRAND_ASSETS } from "@/lib/brand";
import { SITE_DESCRIPTION, SITE_NAME } from "@/lib/site";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: `${SITE_NAME}: Paid reel gigs for creators`,
    short_name: SITE_NAME,
    description: SITE_DESCRIPTION,
    lang: "en-IN",
    dir: "ltr",
    start_url: "/dashboard?source=pwa",
    scope: "/",
    display: "standalone",
    display_override: ["standalone", "minimal-ui"],
    orientation: "portrait",
    categories: ["business", "productivity", "social"],
    background_color: "#0b2f29",
    theme_color: "#0b2f29",
    icons: [
      {
        src: BRAND_ASSETS.icon192,
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: BRAND_ASSETS.maskable512,
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: BRAND_ASSETS.icon512,
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
    ],
    shortcuts: [
      { name: "Find gigs", short_name: "Gigs", url: "/dashboard?section=find", icons: [{ src: BRAND_ASSETS.icon192, sizes: "192x192", type: "image/png" }] },
      { name: "My jobs", short_name: "Jobs", url: "/dashboard?section=jobs", icons: [{ src: BRAND_ASSETS.icon192, sizes: "192x192", type: "image/png" }] },
      { name: "Wallet", short_name: "Wallet", url: "/dashboard?section=wallet", icons: [{ src: BRAND_ASSETS.icon192, sizes: "192x192", type: "image/png" }] },
    ],
  };
}
