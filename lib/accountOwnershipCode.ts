/** Ignore presentation-only formatting without accepting a different verification token. */
function normalize(value: string) {
  return value.normalize("NFKC").replace(/\p{Cf}/gu, "").replace(/[\u2010-\u2015\u2212\ufe63\uff0d]/g, "-").toUpperCase();
}

/** Match the full code in a biography already bound to the requested platform account. */
export function matchesAccountOwnershipCode(biography: unknown, expectedCode: string): boolean {
  if (typeof biography !== "string") return false;
  const code = normalize(expectedCode).replace(/\s+/g, "");
  if (!/^RL-[A-Z0-9]{6}$/.test(code)) return false;
  const token = new RegExp(`(^|[^\\p{L}\\p{N}_])RL\\s*-\\s*${code.slice(3)}(?=$|[^\\p{L}\\p{N}_])`, "u");
  return token.test(normalize(biography));
}
