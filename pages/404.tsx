import Head from "next/head";
import NotFoundView from "@/app/_components/NotFoundView";

// Same screen as app/not-found.tsx, for 404s the pages router serves.
export default function NotFoundPage() {
  return (
    <>
      <Head>
        <title>Page not found | Reelencer</title>
        <meta name="robots" content="noindex, follow" />
      </Head>
      <NotFoundView />
    </>
  );
}
