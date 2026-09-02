import { describe, it, expect } from 'vitest';
import { bootedScript, servedScript, isNewBuild, isKioskOrigin } from './buildVersion';

/**
 * RM-043. MEASURED on the live Pi 2026-09-02: the office kiosk's Chromium had been running
 * since 25 August and the dashboard had been rebuilt on 1 September. A single-page app never
 * reloads itself, so the office display had been showing week-old software through every deploy
 * in between — while the same URL over Tailscale, opened fresh each time, showed the current one.
 * Nothing was broken; nothing said anything either.
 */

const html = (src: string) =>
  `<!doctype html><html><head><script type="module" crossorigin src="${src}"></script></head><body></body></html>`;

describe('servedScript', () => {
  it('finds the module bundle Vite emitted', () => {
    expect(servedScript(html('/assets/index-B5f3lcns.js'))).toBe('/assets/index-B5f3lcns.js');
  });

  it('ignores a non-module script, which is not the app', () => {
    expect(servedScript('<script src="/analytics.js"></script>')).toBeNull();
  });

  it('returns null for html it cannot read rather than guessing', () => {
    // A proxy error page, a captive portal, half a response. Guessing here would reload the
    // kiosk in a loop against a page that never contains a bundle.
    for (const junk of ['', '<html>oops</html>', 'not html at all']) {
      expect(servedScript(junk)).toBeNull();
    }
  });

  it('reads the dev entry too, so development never looks like a permanent new build', () => {
    expect(servedScript(html('/src/main.tsx'))).toBe('/src/main.tsx');
  });
});

describe('isNewBuild', () => {
  it('is true when the served bundle hash differs from the running one', () => {
    expect(isNewBuild('/assets/index-AAAA.js', '/assets/index-BBBB.js')).toBe(true);
  });

  it('is false for the same bundle', () => {
    expect(isNewBuild('/assets/index-AAAA.js', '/assets/index-AAAA.js')).toBe(false);
  });

  it('is false when either side is unknown, because a reload must be EARNED', () => {
    // THE PROPERTY THAT MATTERS MOST. Anything ambiguous — a failed fetch, an error page, a dev
    // server without a hashed bundle — must not reload. A wrong `true` here puts the office
    // display into a reload loop, which is far worse than showing a slightly old build.
    expect(isNewBuild(null, '/assets/index-BBBB.js')).toBe(false);
    expect(isNewBuild('/assets/index-AAAA.js', null)).toBe(false);
    expect(isNewBuild(null, null)).toBe(false);
  });

  it('is false in development, where the entry path never changes', () => {
    expect(isNewBuild('/src/main.tsx', '/src/main.tsx')).toBe(false);
  });
});

describe('bootedScript', () => {
  it('reads what this document actually loaded, not what the server now offers', () => {
    // Taken from the DOM rather than from a first poll on purpose: a tab that loaded build A and
    // first polled after build B shipped would otherwise adopt B as its baseline and never
    // reload, which is exactly the stale-kiosk case this exists to end.
    const doc = new DOMParser().parseFromString(html('/assets/index-CCCC.js'), 'text/html');
    expect(bootedScript(doc)).toBe('/assets/index-CCCC.js');
  });

  it('is null in a document with no module script', () => {
    const doc = new DOMParser().parseFromString('<html><body></body></html>', 'text/html');
    expect(bootedScript(doc)).toBeNull();
  });
});

describe('isKioskOrigin', () => {
  it('recognises the office display, which is the one nobody is sitting at', () => {
    // `ibems-kiosk.service` launches Chromium with `--app=http://127.0.0.1:5183/`. A screen on
    // loopback has no operator to click a banner, so it is the one that may reload itself.
    expect(isKioskOrigin('127.0.0.1')).toBe(true);
    expect(isKioskOrigin('localhost')).toBe(true);
    expect(isKioskOrigin('[::1]')).toBe(true);
  });

  it('does not treat a remote viewer as a kiosk', () => {
    // Somebody over Tailscale may be mid-command. They get an offer, not an interruption.
    expect(isKioskOrigin('bems.example.ts.net')).toBe(false);
    expect(isKioskOrigin('100.73.48.96')).toBe(false);
  });
});
