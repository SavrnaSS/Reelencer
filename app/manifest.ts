import type { MetadataRoute } from "next";
import { BRAND_ASSETS } from "@/lib/brand";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Reelencer",
    short_name: "Reelencer",
    description: "Verified creator marketplace with assignment and payout operations.",
    start_url: "/",
    display: "standalone",
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
  };
}
