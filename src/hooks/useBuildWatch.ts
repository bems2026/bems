/**
 * Notices when a new build has been deployed under a running tab — RM-043.
 *
 * See `src/lib/buildVersion.ts` for the measurement that prompted this: the office kiosk ran a
 * week-old build through four deploys because a single-page app never reloads itself.
 *
 * WHY POLLING AND NOT A SOCKET. There already is a live socket (`/ws/live`), and putting a build
 * id on it would couple "is the dashboard current" to "is the bridge reachable" — two failures
 * that must stay separable, because the second is the one operators are usually chasing when
 * they most need the first to be true. A conditional GET of one small file every few minutes
 * costs nothing and fails independently.
 *
 * WHO RELOADS. The kiosk reloads itself, because nobody is standing at it to be asked. Every
 * other viewer is offered a reload and decides — they may be mid-command, and a dashboard that
 * refreshed itself under someone's hand would be a worse bug than the one this fixes.
 */
import { useEffect, useState } from 'react';
import { bootedScript, servedScript, isNewBuild, isKioskOrigin } from '@/lib/buildVersion';

/** Five minutes. A deploy is a human act a few times a week; this is soon enough that nobody
 * notices the lag and rare enough to be invisible in the proxy log. */
export const BUILD_CHECK_MS = 5 * 60 * 1000;

/** How long the kiosk must have gone untouched before it reloads itself. Somebody IS
 * occasionally standing at the office display, and a reload under their finger is the same
 * discourtesy this avoids for remote viewers. */
export const KIOSK_IDLE_MS = 60 * 1000;

/**
 * How often to re-check for idleness once a new build is already known about.
 *
 * Deliberately much shorter than `BUILD_CHECK_MS`. Waiting a full five minutes to look again
 * would make the idle guard nearly useless: it would only ever hold a reload back if somebody
 * happened to touch the screen in the minute before a poll, and would then leave the display
 * stale for another five. Once the answer is known, the only remaining question is whether the
 * screen is free — and that is cheap to ask.
 */
export const IDLE_RECHECK_MS = 15 * 1000;

export interface BuildWatch {
  /** A different build is being served than the one running here. */
  stale: boolean;
}

export function useBuildWatch(): BuildWatch {
  const [stale, setStale] = useState(false);

  useEffect(() => {
    const booted = bootedScript();
    // Nothing to compare against — a document with no module script is not something this can
    // reason about, and guessing would mean reloading on every poll.
    if (!booted) return;

    let cancelled = false;
    let lastInteraction = Date.now();
    const touch = () => {
      lastInteraction = Date.now();
    };
    for (const ev of ['pointerdown', 'keydown', 'wheel', 'touchstart']) {
      window.addEventListener(ev, touch, { passive: true });
    }

    const check = async () => {
      try {
        // `no-store` so this asks the server rather than the browser's own cache, which is the
        // whole point — a cached answer would agree with whatever is already running forever.
        const res = await fetch(`${window.location.pathname}?build-check=${Date.now()}`, {
          cache: 'no-store',
          headers: { Accept: 'text/html' },
        });
        if (!res.ok || cancelled) return;
        const served = servedScript(await res.text());
        if (!isNewBuild(booted, served)) return;

        // Known now, so stop asking WHAT is served and start asking only whether this screen is
        // free. The banner goes up either way: on the kiosk it is momentary, and on a screen
        // somebody is using it is the whole answer.
        setStale(true);
        window.clearInterval(buildTimer);
        if (!isKioskOrigin(window.location.hostname)) return;
        const reloadWhenIdle = () => {
          if (Date.now() - lastInteraction < KIOSK_IDLE_MS) return;
          // The office display, untouched. Reload rather than leaving a banner nobody will click.
          window.location.reload();
        };
        reloadWhenIdle();
        idleTimer = window.setInterval(reloadWhenIdle, IDLE_RECHECK_MS);
      } catch {
        // A failed check is not a new build. The dashboard is often looked at precisely when the
        // network is unhappy, and a reload prompt appearing because of that would be noise at
        // the worst moment.
      }
    };

    const buildTimer = window.setInterval(() => void check(), BUILD_CHECK_MS);
    let idleTimer = 0;
    return () => {
      cancelled = true;
      window.clearInterval(buildTimer);
      window.clearInterval(idleTimer);
      for (const ev of ['pointerdown', 'keydown', 'wheel', 'touchstart']) {
        window.removeEventListener(ev, touch);
      }
    };
  }, []);

  return { stale };
}
