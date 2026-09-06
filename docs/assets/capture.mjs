/**
 * Screenshots the dashboard for the README, against the mock bridge.
 *
 *     # terminal 1 — the fake bridge. NOT port 1880: that is Node-RED on the Pi.
 *     TZ=Etc/GMT+6 npm run mock -- --port=1881 --dispatch=switch
 *     # terminal 2
 *     node docs/assets/capture.mjs [page...]
 *
 * WHAT IS IN THESE PICTURES: `mock-bridge/fixturePlan.mjs`, and nothing else. No real reading,
 * no real address, no credential. This script builds the app itself with `VITE_SUPABASE_*`
 * forced empty, so the bundle carries no project identifier and the app runs unauthenticated —
 * `src/config/supabase.ts` returns `null`, and the login gate only exists when Supabase is
 * configured. Building without that override picks up the repository's own `.env` and produces
 * a bundle with real credentials in it, which is why this does not reuse `dist/`.
 * A screenshot is a publication; this is what makes these safe to publish.
 *
 * WHY `TZ`: the fixture's occupancy curve reads `new Date().getHours()`, so a mock started at
 * midnight simulates an empty building and every screenshot shows a dark, idle office.
 * `Etc/GMT+6` puts the fixture's clock in mid-morning. It shifts nothing else — timestamps are
 * absolute, and rendered at the site's own +08 either way.
 *
 * WHY FIREFOX, AND WHY AN INVISIBLE IMAGE
 *
 * Headless Chromium on this Pi never completes an HTTP navigation — `Page.navigate` hangs with
 * the request sent and no response, on any local server, while `file://` renders fine. Measured
 * over the DevTools protocol; not worth more of anyone's time. Firefox loads the same URL in
 * under a second.
 *
 * But `firefox --screenshot` fires on the page's `load` event, which for this app is about a
 * second before the first bridge payload arrives — the first attempt produced a perfect,
 * fully-rendered fleet table reading `0 online` and `NO DATA` in every row. So the server below
 * injects a 1x1 image whose response is deliberately held for a few seconds. An image delays
 * `load` without blocking parsing or script execution, so the app boots normally, the socket
 * delivers, the charts animate, and only then does the shot fire. `HOLD_MS` is the only knob.
 */
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync, statSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../..');

const BRIDGE = process.env.CAPTURE_BRIDGE ?? 'http://127.0.0.1:1881';
const PORT = Number(process.env.CAPTURE_PORT ?? 5199);
/** How long the injected image withholds the `load` event. Everything else is the app's own. */
const HOLD_MS = Number(process.env.CAPTURE_HOLD_MS ?? 9000);
const VIEWPORT = { width: 1440, height: 900 };

/** `height` overrides the default viewport where a page needs more of itself to make sense. */
const PAGES = [
  { id: 'overview', out: 'shot-overview' },
  { id: 'analytics', out: 'shot-analytics' },
  // Taller: without Supabase there is no drawn floor plan, so the top of this page is two empty
  // panels saying so. The controls that matter — the relay list and the dispatch badges — are
  // below them.
  { id: 'control', out: 'shot-control', height: 1200 },
  { id: 'devices', out: 'shot-devices' },
  { id: 'automation', out: 'shot-automation' },
];

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.png': 'image/png',
  '.json': 'application/json',
};
/** Smallest transparent GIF there is. The image only has to exist and be slow. */
const PIXEL = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

function build(outDir) {
  const env = {
    ...process.env,
    // Empty, not absent: Vite would otherwise read the repository's own `.env`.
    VITE_SUPABASE_URL: '',
    VITE_SUPABASE_ANON_KEY: '',
    VITE_BRIDGE_HTTP_URL: `${BRIDGE}/api`,
    VITE_BRIDGE_WS_URL: `${BRIDGE.replace(/^http/, 'ws')}/ws/live`,
  };
  const r = spawnSync('npx', ['vite', 'build', '--outDir', outDir, '--emptyOutDir'], {
    cwd: REPO,
    env,
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  if (r.status !== 0) throw new Error('vite build failed');
  const bundle = readFileSync(path.join(outDir, 'index.html'), 'utf8');
  if (/supabase\.co/.test(bundle)) throw new Error('index.html names a Supabase project — refusing to screenshot it');
}

function serve(root) {
  const index = readFileSync(path.join(root, 'index.html'), 'utf8').replace(
    '</body>',
    `<img src="/__hold" alt="" width="1" height="1" style="position:fixed;left:-9999px"></body>`,
  );
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/__hold') {
      setTimeout(() => res.writeHead(200, { 'content-type': 'image/gif' }).end(PIXEL), HOLD_MS);
      return;
    }
    // Everything that is not a real file is the SPA's own index — the routes are hashes, but
    // a stray path must not 404 into a blank screenshot.
    const file = path.join(root, path.normalize(url.pathname));
    if (!file.startsWith(root) || !existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(200, { 'content-type': MIME['.html'] }).end(index);
      return;
    }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream' }).end(readFileSync(file));
  });
  return new Promise((resolve) => server.listen(PORT, '127.0.0.1', () => resolve(server)));
}

/** Promise-wrapped `spawn`, resolving to the same `{ status, signal, error }` shape as `spawnSync`. */
function run(bin, args, opts) {
  return new Promise((resolve) => {
    const child = spawn(bin, args, opts);
    const timer = opts.timeout ? setTimeout(() => child.kill('SIGTERM'), opts.timeout) : null;
    child.on('error', (error) => (clearTimeout(timer), resolve({ status: null, signal: null, error })));
    child.on('exit', (status, signal) => (clearTimeout(timer), resolve({ status, signal, error: null })));
  });
}

/**
 * A profile per shot. Firefox restores the previous session into a reused profile, which turned
 * the second page's launch into a hang; and these prefs are what get WebGL out of a headless
 * browser with no GPU, so the Overview hero draws its 3D office rather than falling back to the
 * 2D floor plan.
 */
function makeProfile(dir) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    path.join(dir, 'user.js'),
    [
      'user_pref("webgl.force-enabled", true);',
      'user_pref("webgl.disabled", false);',
      'user_pref("webgl.out-of-process", false);',
      'user_pref("gfx.webrender.all", true);',
      'user_pref("gfx.webrender.software", true);',
      'user_pref("browser.sessionstore.resume_from_crash", false);',
      'user_pref("browser.shell.checkDefaultBrowser", false);',
      'user_pref("datareporting.policy.dataSubmissionEnabled", false);',
      'user_pref("toolkit.telemetry.enabled", false);',
    ].join('\n'),
  );
  return dir;
}

function firefox() {
  for (const bin of ['firefox', 'firefox-esr']) {
    try {
      return execFileSync('which', [bin], { encoding: 'utf8' }).trim();
    } catch {
      /* next */
    }
  }
  throw new Error('no Firefox found — see this file’s header for why it is not Chromium');
}

async function reachable(url) {
  try {
    return (await fetch(url, { signal: AbortSignal.timeout(4000) })).ok;
  } catch {
    return false;
  }
}

if (!(await reachable(`${BRIDGE}/api/readings/latest`))) {
  throw new Error(`no mock bridge on ${BRIDGE} — start it first:\n  TZ=Etc/GMT+6 npm run mock -- --port=1881 --dispatch=switch`);
}

const requested = process.argv.slice(2);
const pages = requested.length ? PAGES.filter((p) => requested.includes(p.id)) : PAGES;
if (!pages.length) throw new Error(`no such page — known: ${PAGES.map((p) => p.id).join(', ')}`);

const work = mkdtempSync(path.join(tmpdir(), 'ibems-capture-'));
const dist = path.join(work, 'dist');

let server;
try {
  console.log('building (Supabase forced empty)…');
  build(dist);
  server = await serve(dist);
  console.log(`serving ${dist} on http://127.0.0.1:${PORT}\n`);

  const bin = firefox();
  let total = 0;
  for (const page of pages) {
    const out = path.join(HERE, `${page.out}.png`);
    // `spawn`, never `spawnSync`: the static server above lives in THIS process's event loop,
    // and a synchronous child blocks it — Firefox then waits forever for a page nobody is
    // serving, and the whole run dies on a 120 s timeout with no screenshot and no clue.
    const r = await run(
      bin,
      [
        '--headless',
        '--profile', makeProfile(path.join(work, `profile-${page.id}`)),
        '--window-size', `${VIEWPORT.width},${page.height ?? VIEWPORT.height}`,
        '--screenshot', out,
        `http://127.0.0.1:${PORT}/#${page.id}`,
      ],
      { stdio: ['ignore', 'ignore', 'inherit'], timeout: 180_000 },
    );
    if (r.status !== 0 || !existsSync(out)) {
      throw new Error(
        `${page.id}: Firefox wrote no screenshot — status=${r.status} signal=${r.signal} error=${r.error?.message ?? 'none'}`,
      );
    }
    const bytes = statSync(out).size;
    total += bytes;
    console.log(`  ${path.relative(process.cwd(), out).padEnd(34)} ${VIEWPORT.width}x${page.height ?? VIEWPORT.height}  ${(bytes / 1024).toFixed(0)} KB`);
  }
  console.log(`\n${(total / 1024).toFixed(0)} KB written`);
} finally {
  server?.close();
  rmSync(work, { recursive: true, force: true });
}
