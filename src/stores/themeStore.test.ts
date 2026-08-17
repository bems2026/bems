import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';

/**
 * `useThemeStore` applies the theme to `<html>` at MODULE INIT time (see its header for
 * why: avoiding a flash-of-wrong-theme on load matters more than avoiding the impurity of
 * a side effect at import time). That makes it a singleton whose init only runs once per
 * module registry — `vi.resetModules()` + a fresh dynamic `import()` per test is what lets
 * each test observe a clean init against whatever localStorage state it set up first.
 */
async function freshStore() {
  vi.resetModules();
  const { useThemeStore } = await import('./themeStore');
  return useThemeStore;
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
});

afterEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
});

describe('useThemeStore', () => {
  it('defaults to light with nothing in localStorage — this is a kiosk, not a device with a meaningful OS preference to defer to', async () => {
    const useThemeStore = await freshStore();
    expect(useThemeStore.getState().theme).toBe('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('toggle flips to dark, applies it to <html>, and persists it', async () => {
    const useThemeStore = await freshStore();
    useThemeStore.getState().toggle();
    expect(useThemeStore.getState().theme).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(localStorage.getItem('ibems-theme')).toBe('dark');
  });

  it('toggle twice returns to light', async () => {
    const useThemeStore = await freshStore();
    useThemeStore.getState().toggle();
    useThemeStore.getState().toggle();
    expect(useThemeStore.getState().theme).toBe('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('a fresh load picks up a previously saved dark preference', async () => {
    localStorage.setItem('ibems-theme', 'dark');
    const useThemeStore = await freshStore();
    expect(useThemeStore.getState().theme).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('an unrecognized stored value falls back to light rather than throwing', async () => {
    localStorage.setItem('ibems-theme', 'purple-haze');
    const useThemeStore = await freshStore();
    expect(useThemeStore.getState().theme).toBe('light');
  });
});
