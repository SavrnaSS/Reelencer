"use client";

// Carries the email typed on the homepage over to /signup or /login without putting it in the URL
// (query strings leak into history, server logs and analytics). Scoped to the tab via sessionStorage.

import { useEffect, useRef, useState } from "react";

const KEY = "reelencer:auth-email";

export function stashAuthEmail(email: string) {
  try {
    if (email) sessionStorage.setItem(KEY, email);
    else sessionStorage.removeItem(KEY);
  } catch {
    // Storage can be blocked (private mode, site data disabled); the user just types it again.
  }
}

export function readAuthEmail(): string | null {
  try {
    return sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function clearAuthEmail() {
  stashAuthEmail("");
}

/**
 * Prefills an auth form with the handed-over email (or an older ?email= link, which is then stripped from the
 * URL) and moves focus to `nextFieldId` if it's still empty. Returns the carried email, or null once the user
 * chooses to change it.
 */
export function useCarriedEmail(queryEmail: string | null | undefined, apply: (email: string) => void, nextFieldId: string) {
  const [carried, setCarried] = useState<string | null>(null);
  const doneRef = useRef(false);

  useEffect(() => {
    if (doneRef.current) return;
    const fromQuery = queryEmail?.trim() || null;
    if (fromQuery) {
      stashAuthEmail(fromQuery);
      const url = new URL(window.location.href);
      url.searchParams.delete("email");
      window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
    }
    const email = fromQuery ?? readAuthEmail()?.trim() ?? null;
    if (!email) return;
    // Applied on the next frame (storage is browser-only), then focus moves on once the field has rendered.
    const frame = requestAnimationFrame(() => {
      doneRef.current = true;
      apply(email);
      setCarried(email);
      requestAnimationFrame(() => {
        const next = document.getElementById(nextFieldId) as HTMLInputElement | null;
        if (next && !next.value) next.focus({ preventScroll: true });
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [queryEmail, apply, nextFieldId]);

  return [carried, setCarried] as const;
}
