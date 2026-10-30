import { adminSessionCache } from "./adminSessionCache";

export const pendingUpiCacheKey = (limit: number) => `pending-upi:v1:${limit}`;

/** Both overview previews must re-read after a UPI decision in any admin panel. */
export function invalidateAdminUpiQueue(adminId: string) {
  for (const limit of [5, 20]) adminSessionCache.invalidate(adminId, pendingUpiCacheKey(limit));
}
