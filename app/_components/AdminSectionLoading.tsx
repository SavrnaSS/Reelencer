import styles from "./adminLoading.module.css";

function Skeleton({ className = "" }: { className?: string }) {
  const rounding = className.includes("rounded-") ? "" : "rounded-[6px]";
  return <div className={`${styles.skeleton} ${rounding} ${className}`} />;
}

function QueueRows() {
  return (
    <div className="space-y-2 p-2">
      {[0, 1, 2, 3].map(row => (
        <div key={row} className="space-y-3 rounded-xl border border-[#eef0ec] p-3">
          <div className="flex items-center gap-2.5">
            <Skeleton className="h-4 w-4 shrink-0" />
            <Skeleton className="h-7 w-7 shrink-0 rounded-full" />
            <Skeleton className={`h-3.5 ${row % 2 ? "w-24" : "w-32"} max-w-[45%]`} />
            <Skeleton className="ml-auto h-3 w-10 shrink-0" />
          </div>
          <div className="space-y-2 pl-7">
            <Skeleton className="h-3 w-[90%]" />
            <Skeleton className="h-3 w-3/5" />
            <div className="flex gap-2 pt-1"><Skeleton className="h-5 w-20 rounded-full" /><Skeleton className="h-5 w-28 rounded-full" /></div>
          </div>
        </div>
      ))}
    </div>
  );
}

export default function AdminSectionLoading({ label = "Loading admin section", variant = "section" }: { label?: string; variant?: "section" | "applications" }) {
  return (
    <div role="status" aria-label={label} className="min-w-0 space-y-4 sm:space-y-5">
      <span className="sr-only">{label}…</span>
      {variant === "applications" ? (
        <div aria-hidden="true" className="space-y-4 sm:space-y-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div className="min-w-0">
              <h1 className="text-[20px] font-semibold tracking-[-0.01em] text-[#1a201c] sm:text-[22px]">Applications</h1>
              <p className="mt-0.5 max-w-[70ch] text-[13px] text-[#616a64]">Screen applicants, message them in bulk and let rules handle the repetitive moves.</p>
            </div>
            <div className="flex min-w-0 flex-wrap gap-2">
              <Skeleton className="h-9 min-w-24 flex-1 sm:w-60 sm:flex-none" />
              <Skeleton className="h-9 w-9 sm:w-24" /><Skeleton className="h-9 w-28" /><Skeleton className="h-9 w-9" />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-1.5 sm:gap-2.5 xl:grid-cols-6">
            {Array.from({ length: 6 }, (_, index) => (
              <div key={index} className="min-w-0 space-y-2 rounded-xl border border-[#e3e5e1] bg-white px-2.5 py-2 sm:rounded-[14px] sm:px-3.5 sm:py-3">
                <Skeleton className="h-3 w-3/4" /><Skeleton className="h-5 w-10 sm:h-6" /><Skeleton className="hidden h-3 w-4/5 sm:block" />
              </div>
            ))}
          </div>
          <div className="grid items-start gap-4 xl:grid-cols-[minmax(280px,340px)_minmax(0,1fr)] 2xl:grid-cols-[380px_minmax(0,1fr)]">
            <div className="min-w-0 overflow-hidden rounded-2xl border border-[#e3e5e1] bg-white">
              <div className="space-y-3 border-b border-[#eef0ec] p-3">
                <div className="flex items-center justify-between gap-4"><Skeleton className="h-5 w-28" /><Skeleton className="h-9 w-28" /></div>
                <div className="flex gap-2"><Skeleton className="h-9 flex-1" /><Skeleton className="h-9 w-24" /></div>
                <div className="flex gap-2"><Skeleton className="h-7 w-16" /><Skeleton className="h-7 w-20" /><Skeleton className="h-7 w-20" /></div>
              </div>
              <QueueRows />
            </div>
            <div className="hidden min-w-0 space-y-3 xl:block">
              <div className="flex h-[54px] items-center justify-between rounded-2xl border border-[#e3e5e1] bg-white px-4"><Skeleton className="h-4 w-2/5" /><Skeleton className="h-8 w-20" /></div>
              <div className="overflow-hidden rounded-2xl border border-[#e3e5e1] bg-white">
                <div className="flex gap-3 border-b border-[#eef0ec] p-5">
                  <Skeleton className="h-11 w-11 shrink-0 rounded-full" />
                  <div className="min-w-0 flex-1 space-y-3"><Skeleton className="h-5 w-1/2" /><Skeleton className="h-3 w-4/5" /><Skeleton className="h-6 w-3/5" /></div>
                </div>
                <div className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
                  <div className="space-y-5 border-r border-[#eef0ec] p-5">
                    <Skeleton className="h-3 w-1/2" />
                    <div className="space-y-5 rounded-xl border border-[#eef0ec] p-4">{[0, 1, 2, 3].map(row => <div key={row} className="flex justify-between gap-5"><Skeleton className="h-3 w-1/3" /><Skeleton className="h-3 w-1/2" /></div>)}</div>
                    <Skeleton className="h-24 w-full rounded-xl" /><Skeleton className="h-16 w-full rounded-xl" />
                  </div>
                  <div className="space-y-4 p-5"><Skeleton className="h-3 w-1/2" /><Skeleton className="h-3 w-4/5" /><Skeleton className="h-10 w-full rounded-xl" /><Skeleton className="h-9 w-full rounded-xl" /><Skeleton className="mt-6 h-3 w-3/4" />{[0, 1, 2, 3].map(row => <Skeleton key={row} className="h-4 w-full" />)}</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div aria-hidden="true" className="space-y-4">
          <div className="flex h-20 items-center gap-4 rounded-xl border border-[#e3e5e1] bg-white p-4"><Skeleton className="h-10 w-10 shrink-0 rounded-xl" /><div className="w-full space-y-3"><Skeleton className="h-4 w-1/3" /><Skeleton className="h-3 w-3/5" /></div></div>
          <div className="grid items-start gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
            <div className="min-w-0 overflow-hidden rounded-xl border border-[#e3e5e1] bg-white"><QueueRows /></div>
            <div className="hidden space-y-5 rounded-xl border border-[#e3e5e1] bg-white p-5 xl:block"><Skeleton className="h-6 w-1/3" /><Skeleton className="h-4 w-2/3" /><Skeleton className="h-40 w-full rounded-xl" /><Skeleton className="h-12 w-full rounded-xl" /></div>
          </div>
        </div>
      )}
    </div>
  );
}
