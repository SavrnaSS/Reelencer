"use client";

import { Button, Icon, Skeleton } from "./dashboardUi";

/** Keep the requested detail layout in place until its listing and application status are available. */
export default function GigDetailPending({ loading, failed, onBack, onRetry }: { loading: boolean; failed: boolean; onBack: () => void; onRetry: () => void }) {
  return (
    <section aria-label="Gig details" aria-busy={loading} className="mx-auto w-full max-w-[1440px] motion-reduce:[&_*]:animate-none">
      <nav aria-label="Breadcrumb" className="flex min-h-11 min-w-0 items-center gap-1 text-[13px]">
        <button type="button" onClick={onBack} aria-label="Back to gigs" className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-[#4b544e] hover:bg-[#e9ebe7] focus-visible:outline-2 focus-visible:outline-[#2e7d4f]">
          <Icon.ChevronLeft className="h-5 w-5" />
        </button>
        <button type="button" onClick={onBack} className="min-h-11 shrink-0 px-1 font-medium text-[#616a64]">Find gigs</button>
        <Icon.ChevronRight className="h-3.5 w-3.5 shrink-0 text-[#a3aaa4]" />
        <span aria-current="page" className="truncate font-medium text-[#1a201c]">Gig details</span>
      </nav>
      {loading ? (
        <>
          <h1 className="sr-only">Gig details</h1>
          <p role="status" className="sr-only">Loading gig details…</p>
          <div aria-hidden="true" className="mt-4 grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_340px] xl:grid-cols-[minmax(0,1fr)_360px] xl:gap-5">
            <div className="min-w-0 space-y-4">
              <div className="gig-detail-card space-y-5 p-4 sm:p-6">
                <div className="flex items-center gap-3"><Skeleton className="h-11 w-11 shrink-0 rounded-lg" /><Skeleton className="h-4 w-36 max-w-[65%]" /></div>
                <div className="space-y-2"><Skeleton className="h-7 w-[90%]" /><Skeleton className="h-7 w-[65%]" /></div>
                <div className="flex flex-wrap gap-3"><Skeleton className="h-4 w-24" /><Skeleton className="h-4 w-24" /><Skeleton className="h-4 w-28" /></div>
              </div>
              <div className="gig-detail-card space-y-4 p-4 lg:hidden"><Skeleton className="h-3 w-16" /><Skeleton className="h-7 w-32" /><Skeleton className="h-11 w-full rounded-lg" /></div>
              <div className="gig-detail-card grid grid-cols-3 divide-x divide-[#ebedea]">{[0, 1, 2].map(index => <div key={index} className="min-w-0 space-y-3 p-3 sm:p-4"><Skeleton className="h-3 w-3/4" /><Skeleton className="h-4 w-full" /></div>)}</div>
              <div className="gig-detail-card space-y-4 p-4 sm:p-6"><Skeleton className="h-5 w-40" /><Skeleton className="h-3 w-full" /><div className="grid grid-cols-2 gap-3"><Skeleton className="aspect-video w-full rounded-xl" /><Skeleton className="aspect-video w-full rounded-xl" /></div></div>
            </div>
            <div className="gig-detail-card hidden space-y-5 p-5 lg:block"><Skeleton className="h-3 w-16" /><Skeleton className="h-8 w-36" /><Skeleton className="h-11 w-full rounded-lg" /><Skeleton className="h-3 w-4/5" /></div>
          </div>
        </>
      ) : (
        <div className="gig-detail-card mt-4 px-5 py-10 text-center sm:py-14">
          <h1 className="text-xl font-semibold text-[#1a201c]">{failed ? "Couldn’t load this gig" : "This gig isn’t available"}</h1>
          <p className="mx-auto mt-2 max-w-md text-[13.5px] leading-6 text-[#616a64]">{failed ? "The connection didn’t finish. Try again to load the details." : "The listing may have been removed, or the link may be incorrect. Browse the available gigs to find another opportunity."}</p>
          <div className="mt-5 flex flex-wrap justify-center gap-3">{failed ? <Button variant="primary" className="min-h-11" onClick={onRetry}>Try again</Button> : null}<Button variant="secondary" className="min-h-11" onClick={onBack}>Browse gigs</Button></div>
        </div>
      )}
    </section>
  );
}
