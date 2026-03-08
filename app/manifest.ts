import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Reelencer",
    short_name: "Reelencer",
    description: "Verified creator marketplace with assignment and payout operations.",
    start_url: "/",
    display: "standalone",
    background_color: "#eaf7ff",
    theme_color: "#eaf7ff",
    icons: [
      {
        src: "/logo-mark.svg",
        sizes: "any",
        type: "image/svg+xml",
      },
    ],
  };
}
