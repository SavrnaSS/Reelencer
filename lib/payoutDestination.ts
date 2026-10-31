// Payout destinations: a UPI ID or a bank account. The database stores one destination key per creator
// (upi_configs.upi_id): the UPI ID itself, or bank:<IFSC>:<account number>. Payouts snapshot the same key.
// Keep the rules in sync with save_payout_method (202610310005_bank_payout_method.sql).

export type PayoutMethod = "UPI" | "Bank";

export type ParsedDestination =
  | { method: "UPI"; upiId: string }
  | { method: "Bank"; ifsc: string; accountNumber: string };

export const UPI_PATTERN = /^[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+$/;
export const IFSC_PATTERN = /^[A-Z]{4}0[A-Z0-9]{6}$/;
export const ACCOUNT_NUMBER_PATTERN = /^[0-9]{9,18}$/;
export const ACCOUNT_HOLDER_PATTERN = /^[A-Za-z][A-Za-z .'-]*$/;

export const normalizeIfsc = (value: string) => value.trim().toUpperCase();
export const normalizeAccountNumber = (value: string) => value.replace(/\s/g, "");
export const normalizeAccountHolder = (value: string) => value.trim().replace(/\s+/g, " ");

export const isValidUpi = (value: string) => value.trim().length <= 100 && UPI_PATTERN.test(value.trim());
export const isValidIfsc = (value: string) => IFSC_PATTERN.test(normalizeIfsc(value));
export const isValidAccountNumber = (value: string) => ACCOUNT_NUMBER_PATTERN.test(normalizeAccountNumber(value));
export function isValidAccountHolder(value: string) {
  const name = normalizeAccountHolder(value);
  return name.length >= 2 && name.length <= 100 && ACCOUNT_HOLDER_PATTERN.test(name);
}

export function parseDestination(key?: string | null): ParsedDestination | null {
  const value = String(key ?? "").trim();
  if (!value) return null;
  const bank = value.match(/^bank:([A-Z]{4}0[A-Z0-9]{6}):([0-9]{9,18})$/);
  if (bank) return { method: "Bank", ifsc: bank[1], accountNumber: bank[2] };
  return { method: "UPI", upiId: value };
}

/** "••••8901": enough for a creator to recognise their account without exposing it. */
export const maskAccountNumber = (accountNumber: string) => `••••${accountNumber.slice(-4)}`;

/**
 * One-line description of a destination. Creators see the account number masked; the team (`full`) sees everything
 * needed to send the payment.
 */
export function destinationLabel(key?: string | null, options: { holder?: string | null; full?: boolean } = {}) {
  const parsed = parseDestination(key);
  if (!parsed) return "";
  if (parsed.method === "UPI") return parsed.upiId;
  const account = options.full ? parsed.accountNumber : maskAccountNumber(parsed.accountNumber);
  return [`A/c ${account}`, parsed.ifsc, options.holder?.trim()].filter(Boolean).join(" · ");
}
