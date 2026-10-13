import "server-only";
import { randomInt } from "node:crypto";
import { ApiError } from "@/lib/api/errors";
import { SELFIE_CHALLENGES, SELFIE_SESSION_MINUTES, type SelfieChallengeId } from "@/lib/kycSelfie";
import { decryptSecretText, encryptSecretText } from "@/lib/secretCrypto";

// Capture sessions for live KYC selfies. The token is AES-GCM encrypted (tamper-proof, opaque to the browser) and
// binds the user, the challenge shown on screen and an expiry. A selfie upload must present a valid, unexpired
// token for the same user; the challenge it carries goes into the stored file name for the reviewer.

type SessionPayload = { u: string; c: SelfieChallengeId; exp: number };

export function createSelfieSession(userId: string) {
  const challenge = SELFIE_CHALLENGES[randomInt(SELFIE_CHALLENGES.length)];
  const exp = Date.now() + SELFIE_SESSION_MINUTES * 60_000;
  const token = encryptSecretText(JSON.stringify({ u: userId, c: challenge.id, exp } satisfies SessionPayload));
  return { token, challenge, expiresAt: new Date(exp).toISOString() };
}

export function verifySelfieSession(token: unknown, userId: string): SelfieChallengeId {
  let payload: SessionPayload;
  try {
    payload = JSON.parse(decryptSecretText(String(token ?? ""))) as SessionPayload;
  } catch {
    throw new ApiError(400, "Take your selfie with the in-page camera.", "live_selfie_required");
  }
  if (payload.u !== userId || !SELFIE_CHALLENGES.some((c) => c.id === payload.c)) {
    throw new ApiError(400, "Take your selfie with the in-page camera.", "live_selfie_required");
  }
  if (!Number.isFinite(payload.exp) || payload.exp < Date.now()) {
    throw new ApiError(400, "The camera session expired. Take the selfie again.", "live_selfie_expired");
  }
  return payload.c;
}
