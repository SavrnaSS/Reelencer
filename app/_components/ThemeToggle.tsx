"use client";

import { useEffect } from "react";

export const HOME_THEME_KEY = "reelencer-home-theme";

export type HomeTheme = "light" | "dark";

function readStoredHomeTheme(): HomeTheme | null {
  try {
    const stored = window.localStorage.getItem(HOME_THEME_KEY);
    return stored === "light" || stored === "dark" ? stored : null;
  } catch {
    return null;
  }
}

// Light is the default theme; dark applies only when the visitor picks it.
function readHomeThemePreference(): HomeTheme {
  return readStoredHomeTheme() ?? "light";
}

function applyHomeTheme(theme: HomeTheme) {
  document.documentElement.dataset.homeTheme = theme;
}

function toggleHomeTheme() {
  const next: HomeTheme = document.documentElement.dataset.homeTheme === "light" ? "dark" : "light";
  applyHomeTheme(next);
  try {
    window.localStorage.setItem(HOME_THEME_KEY, next);
  } catch {
    // Storage can be unavailable (private mode); the theme still applies for this visit.
  }
}

/** Re-applies the saved theme after client-side navigation (the layout script covers first paint). */
export function useSyncHomeTheme() {
  useEffect(() => {
    applyHomeTheme(readHomeThemePreference());
  }, []);
}

export function ThemeToggle({ className = "" }: { className?: string }) {
  return (
    <button
      type="button"
      onClick={toggleHomeTheme}
      className={`rx-theme-toggle inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/15 bg-white/[0.05] text-white backdrop-blur-md transition hover:border-white/30 hover:bg-white/10 ${className}`}
      aria-label="Switch between light and dark theme"
      title="Switch theme"
    >
      <svg viewBox="0 0 24 24" className="rx-theme-icon-sun h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
        <circle cx="12" cy="12" r="4" />
        <path strokeLinecap="round" d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4" />
      </svg>
      <svg viewBox="0 0 24 24" className="rx-theme-icon-moon h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
        <path strokeLinecap="round" strokeLinejoin="round" d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" />
      </svg>
    </button>
  );
}
