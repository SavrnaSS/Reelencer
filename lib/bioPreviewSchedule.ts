export const BIO_PREVIEW_DEBOUNCE_MS = 700;
export const BIO_PREVIEW_TIMEOUT_MS = 30_000;

/** Honor either API retry hints or standard Retry-After seconds/HTTP dates. */
export function bioPreviewRetryAfter(header: string | null, seconds: unknown, now = Date.now()) {
  const bodyMs = typeof seconds === "number" && Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : 0;
  const value = header?.trim();
  const headerMs = !value ? 0 : /^\d+(?:\.\d+)?$/.test(value)
    ? Number(value) * 1000
    : Math.max(0, Date.parse(value) - now);
  const delay = Math.max(bodyMs, Number.isFinite(headerMs) ? headerMs : 0);
  return Number.isFinite(delay) && Number.isFinite(new Date(now + delay).getTime()) ? Math.ceil(delay) : 0;
}

/** Failed public reads back off; a readable bio missing its code can be checked more frequently. */
export function bioPreviewNextDelay(state: string, failures: number, retryAfterMs = 0) {
  const attempt = Number.isFinite(failures) ? Math.max(1, Math.floor(failures)) : 1;
  const base = state === "found" ? 15_000 : state === "not_found" ? 60_000
    : [30_000, 60_000, 120_000, 300_000][Math.min(3, attempt - 1)];
  return Math.max(base, Number.isFinite(retryAfterMs) && retryAfterMs > 0 ? retryAfterMs : 0);
}

/** Submitted checks also obey the write endpoint's normal cooldown. */
export function submittedBioNextDelay(state: string, failures: number, retryAfterMs: number, minimumMs: number) {
  return Math.max(minimumMs, bioPreviewNextDelay(state, failures, retryAfterMs));
}

/** Include authentication/session waits in the request's cancellation and timeout budget. */
export function bioCheckWithSignal<T>(operation: () => Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const aborted = () => reject(signal.reason);
    signal.addEventListener("abort", aborted, { once: true });
    operation().then(resolve, reject).finally(() => signal.removeEventListener("abort", aborted));
  });
}
