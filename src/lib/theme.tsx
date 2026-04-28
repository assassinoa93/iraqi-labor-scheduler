import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';

export type Theme = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'iraqi-scheduler-theme';

interface ThemeContextValue {
  theme: Theme;            // The user's stored preference (incl. "system")
  resolvedTheme: 'light' | 'dark'; // What's actually applied right now
  setTheme: (t: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

const resolveTheme = (preference: Theme): 'light' | 'dark' => {
  if (preference === 'dark') return 'dark';
  if (preference === 'light') return 'light';
  // system
  if (typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches) return 'dark';
  return 'light';
};

// Lightweight theme provider. Stores the user's preference in localStorage,
// applies a `dark` class on <html> when the resolved theme is dark, and
// re-evaluates when the OS theme changes (only matters for `system`).
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => {
    if (typeof window === 'undefined') return 'light';
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved === 'dark' || saved === 'light' || saved === 'system') return saved;
    return 'light';
  });
  const [resolvedTheme, setResolvedTheme] = useState<'light' | 'dark'>(() => resolveTheme(theme));

  useEffect(() => {
    const next = resolveTheme(theme);
    setResolvedTheme(next);
    if (typeof document !== 'undefined') {
      document.documentElement.classList.toggle('dark', next === 'dark');
    }
  }, [theme]);

  // Re-evaluate when the OS theme flips (only affects `system` preference).
  useEffect(() => {
    if (theme !== 'system' || typeof window === 'undefined') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => {
      const next: 'light' | 'dark' = mq.matches ? 'dark' : 'light';
      setResolvedTheme(next);
      document.documentElement.classList.toggle('dark', next === 'dark');
    };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [theme]);

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_KEY, t);
    }
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, resolvedTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    return {
      theme: 'light',
      resolvedTheme: 'light',
      setTheme: () => {},
    };
  }
  return ctx;
}
