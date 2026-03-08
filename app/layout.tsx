import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

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
    icon: [{ url: "/logo-mark.svg", type: "image/svg+xml" }],
    apple: [{ url: "/logo-mark.svg", type: "image/svg+xml" }],
    shortcut: ["/logo-mark.svg"],
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
        url: "/og-image.png",
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
    images: ["/og-image.png"],
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
        logo: `${siteUrl}/logo-mark.svg`,
      },
      {
        "@type": "WebSite",
        name: "Reelencer",
        url: siteUrl,
        potentialAction: {
          "@type": "SearchAction",
          target: `${siteUrl}/browse?q={search_term_string}`,
          "query-input": "required name=search_term_string",
        },
      },
    ],
  };

  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
        {children}
      </body>
    </html>
  );
}
