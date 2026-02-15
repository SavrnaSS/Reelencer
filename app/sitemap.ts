import type { MetadataRoute } from "next";

const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL ||
  (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : "https://reelencer.app");

export default function sitemap(): MetadataRoute.Sitemap {
  const routes = [
    "/",
    "/browse",
    "/login",
    "/signup",
    "/post-login",
    "/workspace",
    "/addgigs",
    "/admin",
  ];

  return routes.map((route) => ({
    url: `${siteUrl}${route}`,
    lastModified: new Date(),
    changeFrequency: route === "/" || route === "/browse" ? "daily" : "weekly",
    priority: route === "/" ? 1 : 0.7,
  }));
}
