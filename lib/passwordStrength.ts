// Guidance only: the account rules are unchanged (6+ characters, both entries must match).
export function passwordStrength(value: string) {
  if (!value) return { score: 0, label: "", tone: "" };
  if (value.length < 6) return { score: 1, label: "Too short: use at least 6 characters", tone: "weak" };
  const variety = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((re) => re.test(value)).length;
  const score = Math.min(4, 1 + (value.length >= 10 ? 1 : 0) + (variety >= 2 ? 1 : 0) + (variety >= 3 ? 1 : 0));
  return { score, label: ["", "Weak", "Fair", "Good", "Strong"][score], tone: ["", "weak", "fair", "good", "strong"][score] };
}

/** "match" once both entries are equal, "mismatch" once the confirmation can no longer become a match. */
export function confirmState(password: string, confirm: string) {
  return !confirm ? "" : confirm === password ? "match" : password.startsWith(confirm) ? "" : "mismatch";
}
