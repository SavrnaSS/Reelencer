import type { Metadata, Viewport } from "next";
import { BRAND_ASSETS } from "@/lib/brand";
import { SITE_DESCRIPTION, SITE_KEYWORDS, SITE_NAME, SITE_TAGLINE, SITE_TITLE, SITE_URL, absoluteUrl } from "@/lib/site";
import "./globals.css";

const verification: Metadata["verification"] = {
  ...(process.env.GOOGLE_SITE_VERIFICATION ? { google: process.env.GOOGLE_SITE_VERIFICATION } : {}),
  ...(process.env.YANDEX_SITE_VERIFICATION ? { yandex: process.env.YANDEX_SITE_VERIFICATION } : {}),
  ...(process.env.BING_SITE_VERIFICATION ? { other: { "msvalidate.01": process.env.BING_SITE_VERIFICATION } } : {}),
};

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: SITE_TITLE,
    template: `%s | ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  keywords: SITE_KEYWORDS,
  authors: [{ name: SITE_NAME, url: SITE_URL }],
  creator: SITE_NAME,
  publisher: SITE_NAME,
  category: "business",
  referrer: "strict-origin-when-cross-origin",
  formatDetection: { telephone: false, email: false, address: false },
  // No site-wide canonical: each public page declares its own, so inner pages aren't folded into the home page.
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
  appleWebApp: {
    capable: true,
    title: SITE_NAME,
    statusBarStyle: "default",
  },
  openGraph: {
    type: "website",
    locale: "en_IN",
    siteName: SITE_NAME,
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    images: [{ url: BRAND_ASSETS.share, width: 1200, height: 630, alt: `${SITE_NAME}: ${SITE_TAGLINE}` }],
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
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
  ...(Object.keys(verification).length ? { verification } : {}),
};

export const viewport: Viewport = {
  themeColor: "#eaf7ff",
  colorScheme: "light",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Site-wide structured data: who runs the site and what it is. Page-specific data (e.g. the home FAQ) lives on the page.
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": `${SITE_URL}/#organization`,
        name: SITE_NAME,
        url: SITE_URL,
        description: SITE_DESCRIPTION,
        logo: {
          "@type": "ImageObject",
          url: absoluteUrl(BRAND_ASSETS.logoPng),
        },
        image: absoluteUrl(BRAND_ASSETS.share),
      },
      {
        "@type": "WebSite",
        "@id": `${SITE_URL}/#website`,
        name: SITE_NAME,
        alternateName: SITE_TAGLINE,
        url: SITE_URL,
        description: SITE_DESCRIPTION,
        inLanguage: "en-IN",
        publisher: { "@id": `${SITE_URL}/#organization` },
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
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }}
        />
        {children}
      </body>
    </html>
  );
}
