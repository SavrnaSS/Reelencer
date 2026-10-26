// Reel kit: what a creator needs to record a Content Posting reel. Admins configure a demo screen (today: the
// creator wallet) with sample figures, the hook and closing captions, and optional notes for creators. Stored inside the
// gig's private media list as `Kit::{json}`, so it is saved as a `Media::Kit::…` requirement line: hidden like other
// Media:: lines and ignored by readers that predate it. Pure module: shared by the admin form, creator UI and tests.

import { isSafeMediaUrl } from "./gigSamples";

export type ReelKit = {
  screen: "wallet";
  /** Approved and pending reel earnings (INR) and their reel counts, shown in "Reel earnings". */
  approved: number;
  approvedReels: number;
  pending: number;
  pendingReels: number;
  /** Paid payout cycles and the open withdrawal, shown in the metric tiles and payout list. */
  paidOut: number;
  pendingWithdrawal: number;
  /** Caption over the opening selfie, e.g. "Unemployed people gonna KISS me after seeing THIS 😭". */
  hook: string;
  /** Caption over the closing wallet clip, e.g. "Start earning by posting content every day". */
  caption: string;
  /** The admin's own notes for creators, shown above the steps. */
  steps: string[];
  /** Optional example reel (video or image) shown beside the steps. */
  example?: string;
};

export const REEL_KIT_PREFIX = "Kit::";
export const MAX_KIT_CAPTION = 120;
export const MAX_KIT_STEPS = 6;
export const MAX_KIT_STEP = 160;
const MAX_AMOUNT = 10_000_000;
const MAX_REELS = 100_000;

export const DEFAULT_REEL_KIT: ReelKit = {
  screen: "wallet",
  approved: 5898.47,
  approvedReels: 31,
  pending: 1185.8,
  pendingReels: 26,
  paidOut: 0,
  pendingWithdrawal: 0,
  hook: "Unemployed people gonna KISS me after seeing THIS 😭",
  caption: "Start earning by posting content every day",
  steps: [],
};


const amount = (value: unknown, fallback: number) => {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.min(MAX_AMOUNT, Math.round(n * 100) / 100) : fallback;
};
const count = (value: unknown, fallback: number) => {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.min(MAX_REELS, Math.round(n)) : fallback;
};
const text = (value: unknown, max: number) => (typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "");

/** Normalises untrusted input; missing figures fall back to zero so a partial kit never shows stale defaults. */
export function sanitizeReelKit(raw: unknown): ReelKit | null {
  if (!raw || typeof raw !== "object") return null;
  const v = raw as Record<string, unknown>;
  if (v.screen !== "wallet") return null;
  const steps = Array.isArray(v.steps) ? v.steps.map((step) => text(step, MAX_KIT_STEP)).filter(Boolean).slice(0, MAX_KIT_STEPS) : [];
  return {
    screen: "wallet",
    approved: amount(v.approved, 0),
    approvedReels: count(v.approvedReels, 0),
    pending: amount(v.pending, 0),
    pendingReels: count(v.pendingReels, 0),
    paidOut: amount(v.paidOut, 0),
    pendingWithdrawal: amount(v.pendingWithdrawal, 0),
    hook: text(v.hook, MAX_KIT_CAPTION),
    caption: text(v.caption, MAX_KIT_CAPTION),
    steps,
    ...(isSafeMediaUrl(v.example) ? { example: v.example } : {}),
  };
}

export const isReelKitLine = (line: unknown) => /^kit::/i.test(String(line ?? "").trim());

export function encodeReelKit(kit: ReelKit) {
  return `${REEL_KIT_PREFIX}${JSON.stringify(sanitizeReelKit(kit))}`;
}

function decodeReelKit(line: string) {
  try {
    return sanitizeReelKit(JSON.parse(line.trim().slice(REEL_KIT_PREFIX.length)));
  } catch {
    return null;
  }
}

/** The kit from a gig's requirements (`Media::Kit::…`), or from the admin's media list (`Kit::…`). Last one wins. */
export function parseReelKit(lines: unknown): ReelKit | null {
  if (!Array.isArray(lines)) return null;
  let kit: ReelKit | null = null;
  for (const line of lines) {
    if (typeof line !== "string") continue;
    const value = line.trim().replace(/^media::/i, "");
    if (isReelKitLine(value)) kit = decodeReelKit(value) ?? kit;
  }
  return kit;
}

/** Replaces (or with null, removes) the kit line in the admin's media list, keeping every other line in order. */
export function withReelKit(lines: string[], kit: ReelKit | null) {
  const rest = lines.filter((line) => !isReelKitLine(line));
  return kit ? [...rest, encodeReelKit(kit)] : rest;
}


/* ------------------------------------------------------------------ */
/* The take: one timeline shared by the recording screen and the brief */
/* ------------------------------------------------------------------ */

/**
 * Milliseconds from the moment the take starts (after the optional 3 s countdown). The figures count up, then the
 * screen is browsed like a person would: a few scroll flicks down to the payouts, a click that opens the latest
 * payout cycle, and a hold before the cut.
 */
export const TAKE_TIMELINE = {
  countdownMs: 3000,
  countUpMs: 1800,
  scrollAtMs: 2400,
  /** Each scroll flick: [start offset from scrollAtMs, duration]. The third overshoots slightly, the fourth corrects. */
  flicks: [[0, 480], [700, 460], [1350, 520], [1950, 380]] as ReadonlyArray<readonly [number, number]>,
  openAtMs: 4800,
  /** The pointer travels to the payout cycle, then clicks. */
  clickDelayMs: 750,
  endMs: 7600,
} as const;

/* ------------------------------------------------------------------ */
/* The reel: a selfie hook, then a quick walkthrough of the site      */
/* ------------------------------------------------------------------ */

export type ReelShot = {
  id: "hook" | "chrome" | "search" | "account" | "apply" | "proposal" | "wallet";
  title: string;
  /** Suggested length on the timeline, in seconds. */
  seconds: string;
  camera: "selfie" | "screen";
  film: string;
  caption: string;
  /** Hook captions sit mid-screen over the face; walkthrough captions sit in the lower middle. */
  placement: "middle" | "lower";
};

/**
 * The shot list, modelled on the gig's sample reel (about 14 s): a selfie hook, five quick clips of the site filmed
 * off a screen with the phone's back camera, and the demo wallet to close. Captions come from the kit where set.
 */
export function reelShots(kit: Pick<ReelKit, "hook" | "caption">): ReelShot[] {
  return [
    { id: "hook", title: "Your hook", seconds: "4–5s", camera: "selfie", placement: "middle", caption: kit.hook || DEFAULT_REEL_KIT.hook, film: "Film yourself on the front camera somewhere bright. Look into the lens, smile and move naturally: a hair touch, a nod, a little lean." },
    { id: "chrome", title: "Chrome", seconds: "1–2s", camera: "screen", placement: "lower", caption: "Go to Chrome", film: "Film the app launcher on your laptop or second device, moving in on the Chrome icon as you open it." },
    { id: "search", title: "Search", seconds: "1–2s", camera: "screen", placement: "lower", caption: "Search “Reelencer”", film: "Film the laptop's address bar as reelencer.com is typed in." },
    { id: "account", title: "Home page", seconds: "1s", camera: "screen", placement: "lower", caption: "Create an account", film: "Film the Reelencer home page." },
    { id: "apply", title: "Find gigs", seconds: "2s", camera: "screen", placement: "lower", caption: "Apply to these campaigns and follow the given instructions", film: "Film the Find gigs page with the campaign cards in view." },
    { id: "proposal", title: "Proposal", seconds: "2s", camera: "screen", placement: "lower", caption: "Send the Proposal", film: "Film a gig page while you scroll down to its proposal section." },
    { id: "wallet", title: "Wallet", seconds: "2–3s", camera: "screen", placement: "lower", caption: kit.caption || DEFAULT_REEL_KIT.caption, film: "Film the demo wallet while a take plays, and catch the moment the earnings count up." },
  ];
}

/**
 * The reel is always filmed with the creator's smartphone camera, like the sample video; the setup is which device
 * shows the recording screen: a laptop, or a second phone or tablet.
 */
export type RecordingSetup = "laptop" | "phone";

/** Built-in preparation per setup; an admin's own notes are shown separately. */
export type SetupTip = { kind: "screen" | "glare" | "angle"; title: string; detail: string };

export const SETUP_STEPS: Record<RecordingSetup, SetupTip[]> = {
  laptop: [
    { kind: "screen", title: "Bright and full screen", detail: "Open the demo wallet on the laptop, turn the brightness up and press F." },
    { kind: "glare", title: "No glare", detail: "Wipe the screen and keep lamps and windows out of its reflection." },
    { kind: "angle", title: "Phone upright, slightly angled", detail: "About an arm's length away, with the whole screen in frame." },
  ],
  phone: [
    { kind: "screen", title: "Bright and quiet", detail: "Open the demo wallet on the second phone or tablet, turn the brightness up and Do Not Disturb on." },
    { kind: "glare", title: "No glare", detail: "Prop it up or lay it flat, away from lamps and windows." },
    { kind: "angle", title: "Phone upright, slightly angled", detail: "Hold your main phone close, with the whole screen in frame." },
  ],
};

/* ------------------------------------------------------------------ */
/* Demo wallet screen                                                 */
/* ------------------------------------------------------------------ */

export const DEMO_WALLET_PATH = "/reel-kit/wallet";

export type DemoWallet = Pick<ReelKit, "approved" | "approvedReels" | "pending" | "pendingReels" | "paidOut" | "pendingWithdrawal"> & { name: string };

const PARAMS: Array<[keyof DemoWallet, string]> = [
  ["name", "n"], ["approved", "a"], ["approvedReels", "ar"], ["pending", "p"], ["pendingReels", "pr"], ["paidOut", "po"], ["pendingWithdrawal", "pw"],
];

/** Link to the demo screen. Figures travel in the URL so the page needs no sign-in and holds no account data. */
export function demoWalletHref(kit: ReelKit, name: string) {
  const values: DemoWallet = { ...kit, name: text(name, 24) };
  const search = new URLSearchParams();
  for (const [key, param] of PARAMS) {
    const value = values[key];
    if (value !== "" && value !== 0) search.set(param, String(value));
  }
  const query = search.toString();
  return query ? `${DEMO_WALLET_PATH}?${query}` : DEMO_WALLET_PATH;
}

export function parseDemoWallet(params: Record<string, string | string[] | undefined>): DemoWallet {
  const read = (key: string) => {
    const value = params[key];
    return Array.isArray(value) ? value[0] : value;
  };
  return {
    name: text(read("n"), 24) || "Creator",
    approved: amount(read("a"), 0),
    approvedReels: count(read("ar"), 0),
    pending: amount(read("p"), 0),
    pendingReels: count(read("pr"), 0),
    paidOut: amount(read("po"), 0),
    pendingWithdrawal: amount(read("pw"), 0),
  };
}

export type DemoPayoutBatch = {
  id: string;
  cycleLabel: string;
  periodStart: string;
  periodEnd: string;
  status: string;
  createdAt: string;
  processedAt?: string;
  paidAt?: string;
  method: string;
  items: Array<{ id: string; amountINR: number; status: string; handle?: string }>;
};

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Weekly payout cycles that add up exactly to the demo figures: the paid total spread over three paid cycles
 * (newest largest) and the open withdrawal as one processing cycle. `scale` (0–1) drives the count-up animation.
 */
export function demoPayoutBatches(wallet: Pick<DemoWallet, "paidOut" | "pendingWithdrawal" | "name">, now: number, scale = 1): DemoPayoutBatch[] {
  const handle = wallet.name.toLowerCase().replace(/[^a-z0-9._]/g, "") || "creator";
  const iso = (time: number) => new Date(time).toISOString();
  const cycle = (index: number, status: string, amountINR: number, weeksAgo: number): DemoPayoutBatch => {
    const end = now - weeksAgo * WEEK_MS;
    return {
      id: `demo-${index}`,
      cycleLabel: `Cycle ${String(24 - weeksAgo).padStart(2, "0")}`,
      periodStart: iso(end - WEEK_MS + 1),
      periodEnd: iso(end),
      status,
      createdAt: iso(end + 60 * 60 * 1000),
      ...(status === "paid" ? { processedAt: iso(end + 26 * 60 * 60 * 1000), paidAt: iso(end + 2 * 24 * 60 * 60 * 1000) } : {}),
      method: "UPI",
      items: [{ id: `demo-${index}-item`, amountINR, status: status === "paid" ? "paid" : "processing", handle }],
    };
  };
  const batches: DemoPayoutBatch[] = [];
  if (wallet.pendingWithdrawal > 0) batches.push(cycle(0, "processing", Math.round(wallet.pendingWithdrawal * scale * 100) / 100, 0));
  if (wallet.paidOut > 0) {
    const paise = Math.round(wallet.paidOut * scale * 100);
    const shares = [0.45, 0.33];
    const first = Math.round(paise * shares[0]), second = Math.round(paise * shares[1]);
    [first, second, paise - first - second].forEach((value, index) => batches.push(cycle(index + 1, "paid", value / 100, index + 1)));
  }
  return batches;
}
