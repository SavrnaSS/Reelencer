// Live KYC selfies: the selfie must be taken in-page with the camera while a random challenge is on screen (e.g.
// "Hold up two fingers"). The server issues a short-lived capture session for it and stores the file under a
// `selfie-live-<challenge>-<uuid>.jpg` name, so KYC submission and admin review can tell a live capture from an
// uploaded photo. Pure module: shared by the creator sheet, the admin review panel and the API.

export const SELFIE_CHALLENGES = [
  { id: "two-fingers", text: "Hold up two fingers" },
  { id: "thumbs-up", text: "Give a thumbs up" },
  { id: "open-palm", text: "Show an open palm" },
  { id: "touch-ear", text: "Touch your ear" },
  { id: "touch-chin", text: "Touch your chin" },
  { id: "smile", text: "Give a big smile" },
] as const;
export type SelfieChallengeId = (typeof SELFIE_CHALLENGES)[number]["id"];

/** Minutes a capture session stays valid after the camera opens. */
export const SELFIE_SESSION_MINUTES = 5;

export const LIVE_SELFIE_PREFIX = "selfie-live-";

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const LIVE_NAME = new RegExp(`/${LIVE_SELFIE_PREFIX}([a-z-]+)-${UUID}\\.jpg$`, "i");

/** The challenge a stored selfie was captured with, or null for anything not taken through the live camera. */
export function liveSelfieChallenge(path?: string | null) {
  const id = LIVE_NAME.exec(String(path ?? ""))?.[1];
  return SELFIE_CHALLENGES.find((c) => c.id === id) ?? null;
}

export const isLiveSelfiePath = (path?: string | null) => liveSelfieChallenge(path) !== null;
