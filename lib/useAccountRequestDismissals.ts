"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";
import type { AccountRequestView } from "./accountRequests";
import { accountRequestDecisionKey, accountRequestDismissals, EMPTY_ACCOUNT_REQUEST_DISMISSALS, parseAccountRequestDismissals } from "./accountRequestDismissals";

const serverSnapshot = () => EMPTY_ACCOUNT_REQUEST_DISMISSALS;

/** A creator's dismissed notices are device preferences, separate from request and account state. */
export function useAccountRequestDismissals(userId: string | null) {
  const subscribe = useCallback((listener: () => void) => accountRequestDismissals.subscribe(userId, listener), [userId]);
  const snapshot = useCallback(() => accountRequestDismissals.getSnapshot(userId), [userId]);
  const value = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  const dismissed = useMemo(() => new Set(parseAccountRequestDismissals(value)), [value]);
  const isDismissed = useCallback((request: AccountRequestView) => {
    const decision = accountRequestDecisionKey(request);
    return !!decision && dismissed.has(decision);
  }, [dismissed]);
  const dismiss = useCallback((request: AccountRequestView) => accountRequestDismissals.dismiss(userId, request), [userId]);
  return { isDismissed, dismiss };
}
