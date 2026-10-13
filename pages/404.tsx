import Link from "next/link";

export default function NotFoundPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-white px-6 text-center text-slate-900">
      <p className="text-sm font-semibold uppercase tracking-[0.24em] text-slate-500">404</p>
      <h1 className="text-3xl font-bold tracking-tight">Page not found</h1>
      <p className="max-w-md text-sm text-slate-600">The page you requested does not exist or may have moved.</p>
      <Link
        href="/"
        className="inline-flex items-center rounded-full bg-slate-900 px-5 py-2 text-sm font-semibold text-white transition hover:bg-slate-700"
      >
        Return home
      </Link>
    </main>
  );
}
