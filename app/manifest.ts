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
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
      },
    ],
  };
}
