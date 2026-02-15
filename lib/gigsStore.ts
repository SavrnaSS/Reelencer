import "server-only";

export type Platform = "Instagram" | "X" | "YouTube" | "LinkedIn" | "TikTok";
export type PayoutType = "Per task" | "Per post" | "Monthly";
export type GigStatus = "Open" | "Paused" | "Closed";
export type ApplicationStatus = "Applied" | "Accepted" | "Rejected" | "Withdrawn";

export type Gig = {
  id: string;
  title: string;
  company: string;
  verified: boolean;
  platform: Platform;
  location: string;
  workload: string;
  payout: string;
  payoutType: PayoutType;
  requirements: string[];
  status: GigStatus;
  postedAt: string;
};

export type GigApplication = {
  id: string;
  gigId: string;
  workerId: string;
  workerName?: string;
  status: ApplicationStatus;
  appliedAt: string;
  decidedAt?: string;
};

const seedGigs: Gig[] = [
  {
    id: "GIG-1042",
    title: "Reel Creator — Lifestyle Skincare",
    company: "Lumina Labs",
    verified: true,
    platform: "Instagram",
    location: "Remote",
    workload: "12 reels / month",
    payout: "₹65,000",
    payoutType: "Monthly",
    requirements: ["10k+ followers", "Beauty niche experience", "3-day turnaround"],
    status: "Open",
    postedAt: "Posted 2 days ago",
  },
  {
    id: "GIG-1051",
    title: "Short-Form Editor — Fintech",
    company: "AxisPay",
    verified: true,
    platform: "X",
    location: "Remote",
    workload: "18 posts / week",
    payout: "₹1,200",
    payoutType: "Per post",
    requirements: ["Thread + visuals", "Daily reporting", "Compliance ready"],
    status: "Open",
    postedAt: "Posted today",
  },
  {
    id: "GIG-1017",
    title: "Creator Ops — Fitness Studio",
    company: "PulseCore",
    verified: true,
    platform: "TikTok",
    location: "Hybrid • Mumbai",
    workload: "20 clips / month",
    payout: "₹2,500",
    payoutType: "Per task",
    requirements: ["On-site shoots twice/month", "Editing in CapCut", "Brand-safe music"],
    status: "Open",
    postedAt: "Posted 4 days ago",
  },
  {
    id: "GIG-1099",
    title: "Brand Social Specialist — SaaS",
    company: "NimbusHQ",
    verified: true,
    platform: "LinkedIn",
    location: "Remote",
    workload: "10 posts / month",
    payout: "₹48,000",
    payoutType: "Monthly",
    requirements: ["B2B tone", "Carousel design", "Analytics reporting"],
    status: "Paused",
    postedAt: "Posted 1 day ago",
  },
  {
    id: "GIG-1104",
    title: "Shorts Creator — Consumer Tech",
    company: "Nova Devices",
    verified: true,
    platform: "YouTube",
    location: "Remote",
    workload: "8 shorts / week",
    payout: "₹1,800",
    payoutType: "Per post",
    requirements: ["Voice-over + captions", "UGC style", "48h turnaround"],
    status: "Open",
    postedAt: "Posted 3 hours ago",
  },
  {
    id: "GIG-1112",
    title: "Storyteller — Travel Brand",
    company: "SkyMiles Co.",
    verified: true,
    platform: "Instagram",
    location: "Remote",
    workload: "6 reels / month",
    payout: "₹28,000",
    payoutType: "Monthly",
    requirements: ["Travel niche", "On-camera presence", "Content calendar discipline"],
    status: "Closed",
    postedAt: "Posted 1 week ago",
  },
];

const store = {
  gigs: [...seedGigs],
  applications: [] as GigApplication[],
};

function nowStamp() {
  const d = new Date();
  const pad2 = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function makeId(prefix: string) {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  }
  return `${prefix}-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
}

export function listGigs() {
  return store.gigs;
}

export function upsertGig(input: Partial<Gig>) {
  const id = input.id ?? makeId("GIG");
  const existing = store.gigs.find((g) => g.id === id);
  const next: Gig = {
    id,
    title: input.title ?? existing?.title ?? "Untitled gig",
    company: input.company ?? existing?.company ?? "Verified business",
    verified: input.verified ?? existing?.verified ?? true,
    platform: (input.platform ?? existing?.platform ?? "Instagram") as Platform,
    location: input.location ?? existing?.location ?? "Remote",
    workload: input.workload ?? existing?.workload ?? "",
    payout: input.payout ?? existing?.payout ?? "",
    payoutType: (input.payoutType ?? existing?.payoutType ?? "Per post") as PayoutType,
    requirements: input.requirements ?? existing?.requirements ?? [],
    status: (input.status ?? existing?.status ?? "Open") as GigStatus,
    postedAt: input.postedAt ?? existing?.postedAt ?? nowStamp(),
  };

  if (existing) {
    store.gigs = store.gigs.map((g) => (g.id === id ? next : g));
  } else {
    store.gigs = [next, ...store.gigs];
  }

  return next;
}

export function updateGig(id: string, updates: Partial<Gig>) {
  const existing = store.gigs.find((g) => g.id === id);
  if (!existing) return null;
  return upsertGig({ ...existing, ...updates, id });
}

export function deleteGig(id: string) {
  const existing = store.gigs.find((g) => g.id === id);
  if (!existing) return null;
  store.gigs = store.gigs.filter((g) => g.id !== id);
  store.applications = store.applications.filter((a) => a.gigId !== id);
  return existing;
}

export function listApplications(filters?: { gigId?: string; workerId?: string }) {
  return store.applications.filter((app) => {
    if (filters?.gigId && app.gigId !== filters.gigId) return false;
    if (filters?.workerId && app.workerId !== filters.workerId) return false;
    return true;
  });
}

export function createApplication(input: Partial<GigApplication>) {
  if (!input.gigId || !input.workerId) return null;
  const existing = store.applications.find((a) => a.gigId === input.gigId && a.workerId === input.workerId);
  if (existing) return existing;

  const next: GigApplication = {
    id: input.id ?? makeId("APP"),
    gigId: input.gigId,
    workerId: input.workerId,
    workerName: input.workerName,
    status: (input.status ?? "Applied") as ApplicationStatus,
    appliedAt: input.appliedAt ?? nowStamp(),
    decidedAt: input.decidedAt,
  };

  store.applications = [next, ...store.applications];
  return next;
}

export function updateApplication(id: string, updates: Partial<GigApplication>) {
  const existing = store.applications.find((a) => a.id === id);
  if (!existing) return null;
  const next: GigApplication = { ...existing, ...updates, id };
  store.applications = store.applications.map((a) => (a.id === id ? next : a));
  return next;
}
