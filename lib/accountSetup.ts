// Account setup for Content Posting gigs: before posting starts, the creator makes a fresh account on the platform
// the admin chose (the gig's `platform`) and proves they own it by adding the application's verification code to
// the bio. No password is asked for: Instagram bios are read automatically, other platforms are checked by the team.
// Stored on the application's proposal as `accountSetup`. Older submissions may still carry an encrypted password,
// which never reaches the browser (lib/api/accountSetup.ts). Pure module: shared by the creator form, the admin
// console and tests.

export type AccountSetupStatus = "Submitted" | "ChangesRequested" | "Verified";

/**
 * Whether the verification code is in the bio. "found" / "missing" come from reading the public profile;
 * "unreadable" means the read failed (private, rate limited); "manual" is a platform that can't be read, so the
 * team checks the code by opening the profile.
 */
export type AccountOwnership = "found" | "missing" | "unreadable" | "manual";

/** What the browser sees. A legacy password never leaves the server; `hasPassword` says one is stored. */
export type AccountSetupView = {
  platform: string;
  handle: string;
  profileUrl: string;
  /** Legacy submissions only: the login email. Empty for bio-code verification. */
  email: string;
  phone?: string;
  notes?: string;
  hasPassword: boolean;
  /** The code that has to be in the bio (RL-XXXXXX). */
  verifyCode?: string;
  ownership?: AccountOwnership;
  ownershipDetail?: string;
  /** Last automatic bio check. */
  checkedAt?: string;
  /** Earliest retry permitted after the profile reader requested a pause. */
  ownershipRetryAt?: string;
  /** Public profile numbers from the last read, so the team can see the account is fresh. */
  followers?: number;
  posts?: number;
  isPrivate?: boolean;
  status: AccountSetupStatus;
  /** 1 for the first submission, +1 for every resubmission after a change request. */
  revision: number;
  submittedAt: string;
  reviewNote?: string;
  reviewedAt?: string;
};

/** Server-side shape inside the stored proposal: the view fields plus the encrypted password. */
export type StoredAccountSetup = Omit<AccountSetupView, "hasPassword"> & { passwordEnc?: string };

const STATUSES = ["Submitted", "ChangesRequested", "Verified"] as const;
const OWNERSHIP = ["found", "missing", "unreadable", "manual"] as const;

/** Reads a stored account setup defensively (it lives inside free-form proposal JSON). */
export function readStoredAccountSetup(raw: unknown): StoredAccountSetup | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const v = raw as Record<string, unknown>;
  const status = STATUSES.find((s) => s === v.status);
  if (!status || typeof v.handle !== "string") return undefined;
  const text = (key: string) => (typeof v[key] === "string" && String(v[key]).trim() ? String(v[key]) : undefined);
  const count = (key: string) => (typeof v[key] === "number" && Number.isFinite(v[key]) && Number(v[key]) >= 0 ? Number(v[key]) : undefined);
  const verifyCode = text("verifyCode");
  return {
    platform: text("platform") ?? "",
    handle: v.handle,
    profileUrl: text("profileUrl") ?? "",
    email: text("email") ?? "",
    phone: text("phone"),
    notes: text("notes"),
    passwordEnc: text("passwordEnc"),
    verifyCode: verifyCode && VERIFY_CODE.test(verifyCode) ? verifyCode : undefined,
    ownership: OWNERSHIP.find((o) => o === v.ownership),
    ownershipDetail: text("ownershipDetail"),
    checkedAt: text("checkedAt"),
    ownershipRetryAt: text("ownershipRetryAt") && Number.isFinite(Date.parse(String(v.ownershipRetryAt))) ? String(v.ownershipRetryAt) : undefined,
    followers: count("followers"),
    posts: count("posts"),
    isPrivate: typeof v.isPrivate === "boolean" ? v.isPrivate : undefined,
    status,
    revision: Number.isFinite(Number(v.revision)) && Number(v.revision) > 0 ? Number(v.revision) : 1,
    submittedAt: text("submittedAt") ?? new Date(0).toISOString(),
    reviewNote: text("reviewNote"),
    reviewedAt: text("reviewedAt"),
  };
}

export function publicAccountSetup(raw: unknown): AccountSetupView | undefined {
  const stored = readStoredAccountSetup(raw);
  if (!stored) return undefined;
  const { passwordEnc, ...rest } = stored;
  return { ...rest, hasPassword: !!passwordEnc };
}

/** Every application leaving the server goes through this: the encrypted password never reaches a browser. */
export function redactProposal<T extends { accountSetup?: unknown } | undefined>(proposal: T): T {
  if (!proposal || !("accountSetup" in proposal)) return proposal;
  const view = publicAccountSetup(proposal.accountSetup);
  const { accountSetup: _stored, ...rest } = proposal;
  void _stored;
  return (view ? { ...rest, accountSetup: view } : rest) as T;
}

/** Same format as additional-account requests (lib/accountRequests.ts). */
export const VERIFY_CODE = /^RL-[A-Z0-9]{6}$/;

/** What the creator submits for bio-code verification: no login details. */
export type AccountOwnershipInput = { handle: string; profileUrl: string; notes?: string };

/** Field errors for a bio-code submission (empty object = valid). Shared so the form and the API agree. */
export function validateAccountOwnership(input: AccountOwnershipInput, platform: AccountPlatform) {
  const all = validateAccountSetup({ ...input, email: "", password: "" }, platform, { loginOptional: true });
  const errors: Partial<Record<keyof AccountOwnershipInput, string>> = {};
  if (all.handle) errors.handle = all.handle;
  if (all.profileUrl) errors.profileUrl = all.profileUrl;
  if (all.notes) errors.notes = all.notes;
  return errors;
}

/** Ownership is settled once the code was read in the bio. Other states still need the creator or the team. */
export const ownershipProven = (setup?: Pick<AccountSetupView, "ownership">) => setup?.ownership === "found";

/** Platforms whose public bio the server can read; the rest are checked by the team. */
export const canReadBio = (platform: AccountPlatform) => platform.id === "instagram";

export type AccountSetupInput = {
  handle: string;
  profileUrl: string;
  email: string;
  password: string;
  phone?: string;
  notes?: string;
};

export type AccountPlatform = {
  id: "instagram" | "youtube" | "tiktok" | "x" | "linkedin" | "facebook" | "other";
  /** Name shown to creators ("Instagram", "YouTube"). */
  label: string;
  hosts: string[];
  handleRule: RegExp;
  handleHint: string;
  profileUrl: (handle: string) => string;
  /** Default how-to, shown before any instructions the admin added to the gig. */
  steps: string[];
};

const NO_POSTING = "Hold off on the gig's reels until the account is verified. After that, every approved reel you post on it earns.";

const PLATFORMS: AccountPlatform[] = [
  {
    id: "instagram",
    label: "Instagram",
    hosts: ["instagram.com"],
    handleRule: /^(?!.*\.\.)(?!\.)(?!.*\.$)[a-z0-9._]{1,30}$/,
    handleHint: "Up to 30 letters, numbers, dots or underscores.",
    profileUrl: (handle) => `https://www.instagram.com/${handle}/`,
    steps: [
      "New account: sign up with an email address you control. Existing account: make sure it's public and you can log in.",
      "Set the username, name, profile photo and bio described in the brief.",
      "Switch it to a Professional (Creator) account in Settings, if it isn't one already.",
      NO_POSTING,
    ],
  },
  {
    id: "youtube",
    label: "YouTube",
    hosts: ["youtube.com", "m.youtube.com"],
    handleRule: /^[A-Za-z0-9._-]{3,30}$/,
    handleHint: "3 to 30 letters, numbers, dots, dashes or underscores.",
    profileUrl: (handle) => `https://www.youtube.com/@${handle}`,
    steps: [
      "New channel: create it on a Google account you control. Existing channel: make sure you can sign in to it.",
      "Create a YouTube channel on it and claim the @handle described in the brief.",
      "Verify the channel with your phone number so Shorts, links and custom thumbnails are unlocked.",
      NO_POSTING,
    ],
  },
  {
    id: "tiktok",
    label: "TikTok",
    hosts: ["tiktok.com"],
    handleRule: /^(?!.*\.$)[A-Za-z0-9._]{2,24}$/,
    handleHint: "2 to 24 letters, numbers, dots or underscores.",
    profileUrl: (handle) => `https://www.tiktok.com/@${handle}`,
    steps: [
      "New account: sign up with an email address you control. Existing account: make sure it's public and you can log in.",
      "Set the username, name, photo and bio described in the brief.",
      "Switch it to a Business or Creator account in Settings.",
      NO_POSTING,
    ],
  },
  {
    id: "x",
    label: "X",
    hosts: ["x.com", "twitter.com", "mobile.twitter.com"],
    handleRule: /^[A-Za-z0-9_]{4,15}$/,
    handleHint: "4 to 15 letters, numbers or underscores.",
    profileUrl: (handle) => `https://x.com/${handle}`,
    steps: [
      "New account: sign up with an email address you control. Existing account: make sure it's public and you can log in.",
      "Set the @handle, display name, photo and bio described in the brief.",
      "Confirm the email and add a phone number so the account isn't limited.",
      NO_POSTING,
    ],
  },
  {
    id: "linkedin",
    label: "LinkedIn",
    hosts: ["linkedin.com"],
    handleRule: /^[A-Za-z0-9-]{3,100}$/,
    handleHint: "Your public profile URL name: 3 to 100 letters, numbers or dashes.",
    profileUrl: (handle) => `https://www.linkedin.com/in/${handle}/`,
    steps: [
      "Use a LinkedIn profile you can sign in to, or create one with an email address you control.",
      "Fill in the name, headline, photo and custom public URL described in the brief.",
      NO_POSTING,
    ],
  },
  {
    id: "facebook",
    label: "Facebook",
    hosts: ["facebook.com", "fb.com", "m.facebook.com"],
    handleRule: /^[A-Za-z0-9.]{5,50}$/,
    handleHint: "At least 5 letters, numbers or dots.",
    profileUrl: (handle) => `https://www.facebook.com/${handle}`,
    steps: [
      "Use a Facebook profile or Page you manage, or create one with an email address you control.",
      "Set the name, username, photo and description described in the brief.",
      NO_POSTING,
    ],
  },
];

const OTHER = (label: string): AccountPlatform => ({
  id: "other",
  label: label || "the platform",
  hosts: [],
  handleRule: /^[A-Za-z0-9._-]{2,60}$/,
  handleHint: "Letters, numbers, dots, dashes or underscores.",
  profileUrl: () => "",
  steps: [
    `Use a ${label || "account"} you can sign in to, or create one with an email address you control.`,
    "Set the name, username and profile details described in the brief.",
    NO_POSTING,
  ],
});

/** Maps a gig's platform ("Instagram", "YouTube Shorts", "IG Reels"…) to its account rules. */
export function accountPlatformFor(gigPlatform?: string): AccountPlatform {
  const raw = String(gigPlatform ?? "").trim();
  const value = raw.toLowerCase();
  if (/insta|\big\b|reels/.test(value)) return PLATFORMS[0];
  if (/youtube|\byt\b|shorts/.test(value)) return PLATFORMS[1];
  if (/tiktok|tik tok/.test(value)) return PLATFORMS[2];
  if (/^x$|twitter|\bx\b/.test(value)) return PLATFORMS[3];
  if (/linkedin/.test(value)) return PLATFORMS[4];
  if (/facebook|\bfb\b/.test(value)) return PLATFORMS[5];
  return OTHER(raw);
}

/** Accepts "@name", "name" or a pasted profile link and returns the bare handle. */
export function normalizeHandle(value: string, platform: AccountPlatform) {
  let handle = value.trim();
  try {
    if (/^https?:\/\//i.test(handle) || platform.hosts.some((host) => handle.toLowerCase().startsWith(host) || handle.toLowerCase().startsWith(`www.${host}`))) {
      const url = new URL(/^https?:\/\//i.test(handle) ? handle : `https://${handle}`);
      handle = url.pathname.split("/").filter(Boolean).find((part) => !["channel", "c", "in", "user"].includes(part)) ?? "";
    }
  } catch {
    // not a URL; treat as a handle
  }
  handle = handle.replace(/^@+/, "").trim();
  return platform.id === "instagram" ? handle.toLowerCase() : handle;
}

export function isPlatformProfileUrl(value: string, platform: AccountPlatform) {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" && url.protocol !== "http:") return false;
    if (!platform.hosts.length) return true;
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    return platform.hosts.includes(host);
  } catch {
    return false;
  }
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export const ACCOUNT_LIMITS = { password: 256, phone: 30, notes: 600, email: 254, url: 300 } as const;

/**
 * Field errors for a submission (empty object = valid). Shared so the form and the API agree.
 * `passwordOptional` is for resubmissions, where leaving the password blank keeps the saved one.
 * `loginOptional` drops the email and password requirements (bio-code verification); values given are still checked.
 */
export function validateAccountSetup(input: AccountSetupInput, platform: AccountPlatform, options: { passwordOptional?: boolean; loginOptional?: boolean } = {}) {
  const errors: Partial<Record<keyof AccountSetupInput, string>> = {};
  const handle = normalizeHandle(input.handle, platform);
  if (!handle) errors.handle = `Enter the username of the ${platform.label} account you'll post from.`;
  else if (!platform.handleRule.test(handle)) errors.handle = platform.handleHint;

  const profileUrl = input.profileUrl.trim();
  if (!profileUrl) errors.profileUrl = "Paste the link to the new profile.";
  else if (profileUrl.length > ACCOUNT_LIMITS.url || !isPlatformProfileUrl(profileUrl, platform))
    errors.profileUrl = platform.hosts.length ? `Use a ${platform.label} link (${platform.hosts[0]}/…).` : "Enter a valid link starting with https://";

  const email = input.email.trim();
  if (!email) {
    if (!options.loginOptional) errors.email = "Enter the email the account was created with.";
  }
  else if (email.length > ACCOUNT_LIMITS.email || !EMAIL.test(email)) errors.email = "Enter a valid email address.";

  if (!input.password) {
    if (!options.passwordOptional && !options.loginOptional) errors.password = "Enter the account password.";
  } else if (input.password.length < 6) errors.password = "That looks too short for a real password.";
  else if (input.password.length > ACCOUNT_LIMITS.password) errors.password = "Password is too long.";

  const phone = String(input.phone ?? "").trim();
  if (phone && (phone.length > ACCOUNT_LIMITS.phone || !/^\+?[\d\s()-]{6,}$/.test(phone))) errors.phone = "Enter a valid phone number, or leave it empty.";
  if (String(input.notes ?? "").length > ACCOUNT_LIMITS.notes) errors.notes = `Keep notes under ${ACCOUNT_LIMITS.notes} characters.`;
  return errors;
}

// Admin instructions travel with the gig as a `Meta::account_setup=` requirement line (URI-encoded, multi-line).
const INSTRUCTIONS_KEY = "meta::account_setup=";

export function parseAccountInstructions(requirements: unknown): string {
  if (!Array.isArray(requirements)) return "";
  const line = requirements.find((item) => String(item ?? "").toLowerCase().startsWith(INSTRUCTIONS_KEY));
  if (!line) return "";
  try {
    return decodeURIComponent(String(line).slice(INSTRUCTIONS_KEY.length)).trim();
  } catch {
    return "";
  }
}

export function encodeAccountInstructions(text: string) {
  const clean = text.replace(/\r\n/g, "\n").trim().slice(0, 2000);
  return clean ? `Meta::account_setup=${encodeURIComponent(clean)}` : null;
}

/** Splits admin instructions into display steps ("1. Do x" / "- Do y" / one per line). */
export const instructionLines = (text: string) =>
  text
    .split(/\n+/)
    .map((line) => line.replace(/^\s*(?:\d+[.)]|[-*•])\s*/, "").trim())
    .filter(Boolean);

/** "₹2,800 per approved post" / "₹40,000 a month": how the creator is paid for posting on the account. */
export function payoutPhrase(payout?: string, payoutType?: string) {
  const amount = String(payout ?? "").trim();
  if (!amount) return "";
  const type = String(payoutType ?? "").trim().toLowerCase();
  if (type === "per 1k views") return `${amount} per 1,000 views on approved reels`;
  if (type === "per post") return `${amount} per approved post`;
  if (type === "per task") return `${amount} per approved task`;
  if (type === "monthly") return `${amount} a month`;
  return amount;
}

/** Where the account form sits on the gig page: the setup email links here and the panel scrolls into view. */
export const ACCOUNT_SETUP_ANCHOR = "account-setup";

export const isContentPostingType = (gigType?: string) => String(gigType ?? "").trim().toLowerCase() === "content posting";
