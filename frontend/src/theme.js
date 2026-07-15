import { useState, useEffect, useCallback } from 'react';

const STORAGE_KEY = 'tv_theme';

function getInitialTheme() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'dark' || saved === 'light') return saved;
  } catch { /* storage unavailable — fall through */ }
  // No saved preference yet — respect the OS/browser setting rather than
  // forcing light, since this app is also opened outside Pi Browser.
  try {
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) return 'dark';
  } catch { /* matchMedia unavailable — default to light */ }
  return 'light';
}

/**
 * Dark mode state, shared across the app. Applies `data-theme` to the root
 * <html> element (index.css defines the actual color variables for each
 * value) and persists the choice in localStorage so it survives a reload.
 */
export function useDarkMode() {
  const [theme, setTheme] = useState(getInitialTheme);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try { localStorage.setItem(STORAGE_KEY, theme); } catch { /* non-fatal */ }
  }, [theme]);

  const toggle = useCallback(() => setTheme((t) => (t === 'dark' ? 'light' : 'dark')), []);

  return { theme, isDark: theme === 'dark', toggle };
}
