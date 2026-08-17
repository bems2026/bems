import { create } from 'zustand';

export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'ibems-theme';

/** `localStorage` can throw (private browsing, quota, disabled storage) — wrapped the same
 * way `editableLayout.ts`'s `loadLayout`/`saveLayout` are, so a storage failure degrades to
 * "defaults to light, toggle still works this session," never an uncaught exception from
 * what's otherwise a routine UI action. */
function loadTheme(): Theme {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

function saveTheme(theme: Theme): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Nothing to recover into — the toggle still works for this session via in-memory
    // state, it just won't survive a reload.
  }
}

/** Mirrors the current theme onto `<html data-theme>` — the one thing CSS custom
 * properties can't read directly (see index.css's `:root[data-theme='dark']` block), and
 * `color-scheme` for native form-control chrome (scrollbars, number-input spin buttons). */
function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute('data-theme', theme);
}

interface ThemeState {
  theme: Theme;
  toggle: () => void;
}

/**
 * A manual light/dark toggle — deliberately not `prefers-color-scheme`. This runs as a
 * 24/7 kiosk display (see index.css's dark-theme block header), not a personal device with
 * its own meaningful OS-level preference to defer to. Defaults to light on first load
 * (nothing in localStorage yet) and remembers whatever was last chosen after that.
 *
 * `theme` is applied to the DOM synchronously at module init, not from a `useEffect` after
 * first render — the alternative is a real flash of the wrong theme on every load for
 * anyone who chose dark, which is worse than the minor impurity of a side effect at
 * module scope for a value that can only ever be read once before React even mounts.
 */
export const useThemeStore = create<ThemeState>((set, get) => {
  const initial = loadTheme();
  applyTheme(initial);
  return {
    theme: initial,
    toggle: () => {
      const next: Theme = get().theme === 'dark' ? 'light' : 'dark';
      applyTheme(next);
      saveTheme(next);
      set({ theme: next });
    },
  };
});
