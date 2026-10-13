import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

// Only public, indexable pages. Signed-in and admin pages are noindex and stay out of the sitemap.
const BUILT_AT = new Date();

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: `${SITE_URL}/`, lastModified: BUILT_AT, changeFrequency: "weekly", priority: 1 },
    { url: `${SITE_URL}/signup`, lastModified: BUILT_AT, changeFrequency: "monthly", priority: 0.8 },
    { url: `${SITE_URL}/login`, lastModified: BUILT_AT, changeFrequency: "yearly", priority: 0.4 },
  ];
}
