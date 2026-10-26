import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async redirects() {
    return [
      { source: "/api/admin", destination: "/admin", permanent: false },
      // The public gig feed moved into the dashboard; keep old links and bookmarks working.
      { source: "/browse", destination: "/dashboard?section=find", permanent: true },
      { source: "/browse/:path*", destination: "/dashboard?section=find", permanent: true },
      // Assignments live in the dashboard's Jobs section; the standalone page was retired.
      { source: "/my-assignments", destination: "/dashboard?section=jobs", permanent: true },
      { source: "/my-assignments/:path*", destination: "/dashboard?section=jobs", permanent: true },
    ];
  },
  async headers() {
    return [{
      source: "/:path*",
      headers: [
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "X-Frame-Options", value: "SAMEORIGIN" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=()" },
        { key: "Content-Security-Policy", value: "frame-ancestors 'self'; object-src 'none'; base-uri 'self'" },
        ...(process.env.NODE_ENV === "production" ? [{ key: "Strict-Transport-Security", value: "max-age=31536000" }] : []),
      ],
    }, {
      source: "/auth/:path*",
      headers: [{ key: "Referrer-Policy", value: "no-referrer" }],
    }, {
      // Signed-in, admin and auth pages never belong in search results, whichever way a crawler reaches them.
      source: "/:area(api|admin|addgigs|dashboard|payouts|work-email-creator|workspace|post-login|logout|proceed|auth|reset-password|reel-kit)/:path*",
      headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
    }, {
      source: "/:area(admin|addgigs|dashboard|payouts|work-email-creator|workspace|post-login|logout|proceed|reset-password)",
      headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
    }, {
      source: "/brand/:asset([a-z0-9-]+\\.[a-f0-9]{12}\\.(?:png|webp|ico))",
      headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
    }];
  },
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
