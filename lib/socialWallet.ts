/** Read-only wallet evidence, never a browser-calculated balance or a credit instruction. */
export type SocialPostWalletCredit = {
  creditedINR: number;
  consumedViews: number;
  pendingClaimINR: number;
  fixedCredit: boolean;
};

export type SocialAccountWalletCredits = { amountINR: number; reels: number };

type Row = Record<string, unknown>;
const record = (value: unknown): value is Row => !!value && typeof value === "object" && !Array.isArray(value);
const amount = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0 && Number.isSafeInteger(Math.round(value * 100));
const count = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

export function readSocialPostWalletCredit(value: unknown): SocialPostWalletCredit | undefined {
  if (!record(value) || !amount(value.creditedINR) || !count(value.consumedViews) || !amount(value.pendingClaimINR) || typeof value.fixedCredit !== "boolean") return undefined;
  return { creditedINR: value.creditedINR, consumedViews: value.consumedViews, pendingClaimINR: value.pendingClaimINR, fixedCredit: value.fixedCredit };
}

export function readSocialAccountWalletCredits(value: unknown): SocialAccountWalletCredits | undefined {
  if (!record(value) || !amount(value.amountINR) || !count(value.reels)) return undefined;
  return { amountINR: value.amountINR, reels: value.reels };
}
