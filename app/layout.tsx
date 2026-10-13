import type { Metadata } from "next";
import { BRAND_ASSETS } from "@/lib/brand";
import "./globals.css";

const siteName = "Reelencer";
const siteDescription =
  "Reelencer is a verified gig marketplace for creators and operations teams to manage assignments, compliance, and payouts.";
const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL ||
  (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : "https://reelencer.app");

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "Reelencer | Verified Creator Marketplace",
    template: "%s | Reelencer",
  },
  description: siteDescription,
  applicationName: siteName,
  keywords: [
    "creator marketplace",
    "social media gigs",
    "gig management",
    "creator payouts",
    "reelencer",
  ],
  authors: [{ name: "Reelencer" }],
  creator: "Reelencer",
  publisher: "Reelencer",
  category: "business",
  alternates: {
    canonical: "/",
  },
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: BRAND_ASSETS.favicon, sizes: "any", type: "image/x-icon" },
      { url: BRAND_ASSETS.favicon16, sizes: "16x16", type: "image/png" },
      { url: BRAND_ASSETS.favicon32, sizes: "32x32", type: "image/png" },
      { url: BRAND_ASSETS.icon192, sizes: "192x192", type: "image/png" },
      { url: BRAND_ASSETS.icon512, sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: BRAND_ASSETS.apple180, sizes: "180x180", type: "image/png" }],
    shortcut: [BRAND_ASSETS.favicon],
  },
  openGraph: {
    type: "website",
    locale: "en_US",
    url: "/",
    siteName,
    title: "Reelencer | Verified Creator Marketplace",
    description: siteDescription,
    images: [
      {
        url: BRAND_ASSETS.share,
        width: 1200,
        height: 630,
        alt: "Reelencer",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Reelencer | Verified Creator Marketplace",
    description: siteDescription,
    images: [BRAND_ASSETS.share],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
};

export const viewport = {
  themeColor: "#eaf7ff",
  colorScheme: "light",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        name: "Reelencer",
        url: siteUrl,
        logo: new URL(BRAND_ASSETS.logoPng, siteUrl).href,
      },
      {
        "@type": "WebSite",
        name: "Reelencer",
        url: siteUrl,
      },
    ],
  };

  return (
    <html lang="en" data-scroll-behavior="smooth" suppressHydrationWarning>
      <body className="antialiased">
        {/* Sets the home page colour theme before first paint to avoid a flash. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "(function(){try{var d=document.documentElement,s=localStorage.getItem('reelencer-home-theme');d.dataset.homeTheme=s==='dark'?'dark':'light';}catch(e){}})();",
          }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
        {children}
      </body>
    </html>
  );
}
