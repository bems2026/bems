/**
 * Whether the build this tab is running is still the one the server is handing out — RM-043.
 *
 * WHAT THIS EXISTS FOR. MEASURED on the live Pi, 2026-09-02: the office kiosk's Chromium had
 * been running since 25 August; the dashboard had been rebuilt on 1 September. A single-page app
 * never reloads itself, so the office display had been showing week-old software through every
 * deploy in between — while the same URL over Tailscale, opened fresh each time, showed the
 * current one. Nothing was broken, and nothing said anything either. A screen nobody touches is
 * exactly the screen that never gets refreshed.
 *
 * THE SIGNAL IS THE BUNDLE'S OWN NAME. Vite hashes the entry bundle's filename from its
 * contents, so `index-B5f3lcns.js` becoming `index-Qw3x9Ktz.js` IS a new build, with no version
 * file to emit, no build step to add and nothing to keep in sync. In development the entry is
 * `/src/main.tsx` and never changes, so this is inert there rather than needing a special case.
 *
 * A RELOAD MUST BE EARNED. Every ambiguous answer — a failed fetch, a proxy error page, HTML
 * with no module script — resolves to "no new build". A wrong `true` puts the office display
 * into a reload loop, which is far worse than showing a slightly old build for another hour.
 *
 * Pure and DOM-light, so the rule above is testable without a server or a timer.
 */

/** Vite emits exactly one `<script type="module">` for the entry. Matched on the tag rather than
 * on a path pattern, so this keeps working if the asset directory is ever renamed. */
const MODULE_SCRIPT = /<script[^>]*\btype=["']module["'][^>]*\bsrc=["']([^"']+)["']/i;

/** The entry bundle the SERVER is currently offering, from a freshly fetched index.html. */
export function servedScript(html: string): string | null {
  const m = MODULE_SCRIPT.exec(html);
  return m ? m[1] : null;
}

/**
 * The entry bundle THIS document actually loaded.
 *
 * Read from the DOM rather than remembered from a first poll, and the difference matters: a tab
 * that loaded build A and first polled after build B had shipped would adopt B as its baseline
 * and never reload — which is precisely the stale-kiosk case this module exists to end.
 */
export function bootedScript(doc: Document = document): string | null {
  return doc.querySelector('script[type="module"][src]')?.getAttribute('src') ?? null;
}

/** Whether the server is offering a different build from the one running here. */
export function isNewBuild(booted: string | null, served: string | null): boolean {
  if (!booted || !served) return false;
  return booted !== served;
}

/**
 * Whether this page is the office kiosk — the display with nobody sitting at it.
 *
 * `ibems-kiosk.service` launches Chromium with `--app=http://127.0.0.1:5183/`, so the kiosk is
 * always a loopback origin. That screen may reload itself, because there is no operator to click
 * anything; a remote viewer may be mid-command and gets an offer instead of an interruption.
 */
export function isKioskOrigin(hostname: string): boolean {
  return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '[::1]' || hostname === '::1';
}
