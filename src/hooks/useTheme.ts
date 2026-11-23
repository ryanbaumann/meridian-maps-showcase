import { useCallback, useEffect, useState } from 'react';

export type ResolvedTheme = 'light' | 'dark';
type StoredThemeOverride = 'light' | 'dark' | null;

const STORAGE_KEY = 'color-scheme';

function getSystemTheme(): ResolvedTheme {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return 'light';
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function readStoredOverride(): StoredThemeOverride {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw === 'light' || raw === 'dark' ? raw : null;
  } catch {
    return null;
  }
}

function syncDocumentColorScheme(override: StoredThemeOverride): void {
  if (typeof document === 'undefined') return;
  const meta = document.querySelector('meta[name="color-scheme"]');
  if (override) {
    meta?.setAttribute('content', override);
    document.documentElement.style.colorScheme = override;
    document.documentElement.dataset.theme = override;
  } else {
    meta?.setAttribute('content', 'light dark');
    document.documentElement.style.colorScheme = 'light dark';
    delete document.documentElement.dataset.theme;
  }
}

/**
 * Two-state color-scheme hook following modern web best practices:
 * defaults to the OS preference (`light dark`), and toggling pins the opposite
 * exact scheme (or returns to system preference if toggled back).
 */
export function useTheme(): {
  resolvedTheme: ResolvedTheme;
  toggleTheme: () => void;
} {
  const [systemTheme, setSystemTheme] = useState<ResolvedTheme>(getSystemTheme);
  const [override, setOverride] = useState<StoredThemeOverride>(readStoredOverride);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (e: MediaQueryListEvent) => {
      setSystemTheme(e.matches ? 'dark' : 'light');
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    syncDocumentColorScheme(override);
  }, [override]);

  const resolvedTheme: ResolvedTheme = override ?? systemTheme;

  const toggleTheme = useCallback(() => {
    const nextResolved: ResolvedTheme = resolvedTheme === 'dark' ? 'light' : 'dark';
    const nextOverride: StoredThemeOverride =
      nextResolved === systemTheme ? null : nextResolved;

    setOverride(nextOverride);
    try {
      if (nextOverride) {
        window.localStorage.setItem(STORAGE_KEY, nextOverride);
      } else {
        window.localStorage.removeItem(STORAGE_KEY);
      }
    } catch {
      // Ignore storage failures in restricted iframes
    }
  }, [resolvedTheme, systemTheme]);

  return { resolvedTheme, toggleTheme };
}
