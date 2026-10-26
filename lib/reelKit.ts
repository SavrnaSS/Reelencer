// Reel kit: what a creator needs to record a Content Posting reel. Admins configure a demo screen (today: the
// creator wallet) with sample figures, the caption to put on screen and an optional shot list. Stored inside the
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
  /** On-screen text for the reel, e.g. "Start earning just by posting reels 😱". */
  caption: string;
  /** Shot list; empty means the default steps for the screen. */
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
  caption: "Start earning just by posting reels 😱",
  steps: [],
};

export const DEFAULT_WALLET_STEPS = [
  "Open the recording screen on a laptop and go full screen (press F).",
  "Hold your phone upright and frame the laptop screen at a slight angle, like the example.",
  "Start recording, then press Space or tap Play: the earnings count up and a payout notification lands.",
  "Add the on-screen caption in the lower middle of the frame, above the reel's caption area.",
  "Keep it short and end on the payout notification. Post it, then submit the reel link.",
];

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

export const reelKitSteps = (kit: ReelKit) => (kit.steps.length ? kit.steps : DEFAULT_WALLET_STEPS);

/* ------------------------------------------------------------------ */
/* The take: one timeline shared by the recording screen and the brief */
/* ------------------------------------------------------------------ */

/** postMessage `source` the embedded recording screen uses to announce each take to the reel kit. */
export const REEL_KIT_MESSAGE = "reelencer-reel-kit";

/** Milliseconds from the moment the take starts (after the optional 3 s countdown). */
export const TAKE_TIMELINE = {
  countdownMs: 3000,
  countUpMs: 1800,
  toastAtMs: 2450,
  scrollAtMs: 4000,
  endMs: 6500,
} as const;

/** Area of the 16:10 screen each scene is about, in percent, for the storyboard thumbnails. */
export type SceneFocus = { left: number; top: number; width: number; height: number };

export type TakeScene = { title: string; fromMs: number; toMs: number; screen: string; camera: string; focus: SceneFocus };

/** The storyboard creators follow, timed to what the recording screen does. */
export function takeScenes(options: { scroll: boolean } = { scroll: true }): TakeScene[] {
  const { countUpMs, toastAtMs, scrollAtMs, endMs } = TAKE_TIMELINE;
  const scenes: TakeScene[] = [
    {
      title: "Hook",
      fromMs: 0,
      toMs: countUpMs,
      screen: "Earnings count up from ₹0 while the Reel earnings card glows.",
      camera: "Wide and steady: the whole laptop screen in frame, caption on top.",
      focus: { left: 0, top: 0, width: 100, height: 100 },
    },
    {
      title: "The number lands",
      fromMs: countUpMs,
      toMs: toastAtMs,
      screen: "Approved and pending earnings settle on their final figures.",
      camera: "Push in slowly towards the Reel earnings card.",
      focus: { left: 22, top: 20, width: 76, height: 36 },
    },
    {
      title: "Payout alert",
      fromMs: toastAtMs,
      toMs: options.scroll ? scrollAtMs : endMs,
      screen: "A “credited” notification drops in at the top right.",
      camera: "Tilt up and hold on the notification so it can be read.",
      focus: { left: 64, top: 2, width: 34, height: 18 },
    },
  ];
  if (options.scroll) {
    scenes.push({
      title: "Proof of payouts",
      fromMs: scrollAtMs,
      toMs: endMs,
      screen: "The page scrolls down to the payout cycles and breakdown.",
      camera: "Follow the scroll, hold a beat on the breakdown, then cut.",
      focus: { left: 22, top: 52, width: 76, height: 46 },
    });
  }
  return scenes;
}

/** "0", "1.8", "6.5": seconds into the take, for storyboard labels. */
export const takeSeconds = (ms: number) => String(Math.round(ms / 100) / 10);

export type RecordingSetup = "laptop" | "phone";

/** Built-in instructions per setup; an admin's own shot list is shown separately as their notes. */
export const SETUP_STEPS: Record<RecordingSetup, string[]> = {
  laptop: [
    "Open the recording screen on a laptop, turn the brightness up and press F for full screen.",
    "Clean the screen and dim the room lights so there is no glare or reflection.",
    "Hold your phone upright (9:16) about an arm's length away, slightly angled, with the whole screen in frame.",
    "Start recording on your phone, then press Space on the laptop. The 3-second countdown gives you time to get steady.",
    "Follow the storyboard as the take plays. Stop recording a beat after the payout breakdown.",
    "Add the caption sticker in your editor, trim the countdown, then post and submit the reel link.",
  ],
  phone: [
    "Open the recording screen on your phone and turn on Do Not Disturb so no real notifications appear.",
    "Start your phone's screen recorder (Control Centre on iPhone, Quick Settings on Android).",
    "Tap Play take. The controls hide on their own, so only the wallet is recorded.",
    "Let the full take play through to the payout breakdown, then stop the screen recording.",
    "Trim the start, add the caption sticker and, if you like, a short clip of yourself reacting, then post and submit the link.",
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
