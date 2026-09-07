/**
 * Screenshots the dashboard for the README, in a building that does not exist.
 *
 *     node docs/assets/capture.mjs [page...]
 *
 * WHY A DEMO BUILDING. iBEMS is a framework: the building-specific half lives in
 * `shared/sites/<slug>/`, and this checkout is pointed at whichever one it is deployed in. A
 * front page showing that deployment's name, its circuit names and its room would be
 * advertising one office rather than the framework. So this builds `docs/assets/demo-site/`
 * instead — a neutral, coherent, entirely invented building — and screenshots that.
 *
 * WHY A GIT WORKTREE. Selecting a site is a build-time fact (`shared/siteConfig.mjs` is a static
 * re-export, deliberately: a browser bundle has no `process.env`). Pointing it at the demo site
 * therefore means editing a tracked file — and on a machine that is also serving a live kiosk
 * from `dist/`, a script that rewrites `shared/` even briefly is a script that can take a
 * building's dashboard off its own site. So the swap happens inside a throwaway worktree checked
 * out from HEAD. Nothing in your working tree is written to, at any point, including on a crash.
 *
 * WHAT IS IN THE PICTURES: `docs/assets/demo-site/` and `mock-bridge/fixturePlan.mjs`. No real
 * reading, no real address, no credential. The build forces `VITE_SUPABASE_*` empty, so the
 * bundle names no database project and the app runs unauthenticated — the login gate only exists
 * when Supabase is configured. Building without that override picks up the repository's own
 * `.env`, and the first attempt at these screenshots produced a login screen with a real
 * project's credentials compiled into it. The build is refused if the bundle names a project.
 *
 * WHY THE CLOCK IS MOVED. The mock's occupancy curve reads `new Date().getHours()`, so a run
 * started at night simulates an empty building and every screenshot shows an idle one. So the
 * capture picks the `Etc/GMT±N` zone that puts *this instant* at mid-morning, runs the mock in
 * it, AND writes the same offset into the demo site — so the fixture's working day, the chart's
 * time axis and the clock in the corner of the shot all agree. Getting only the first of those
 * right is what an earlier version did, and it produced a building busy at two in the morning.
 *
 * WHY FIREFOX, AND WHY AN INVISIBLE IMAGE
 *
 * Headless Chromium on this hardware never completes an HTTP navigation: the request goes out,
 * no response arrives, `Page.navigate` hangs — on any local server, at every flag combination
 * worth trying, while `file://` renders fine. Measured over the DevTools protocol. Firefox loads
 * the same URL in under a second, which is why `render.mjs` (all `file://`) and this file use
 * different browsers. Do not "simplify" them onto one.
 *
 * And `firefox --screenshot` fires on the page's `load` event, about a second before the first
 * bridge payload arrives — the first working attempt was a perfectly rendered fleet table
 * reading `0 online` in every row. So the server below injects a 1x1 image whose response is
 * held for `CAPTURE_HOLD_MS`. An image delays `load` without blocking parsing or script
 * execution, so the app boots, the socket delivers, the charts animate, and only then does the
 * shutter fall.
 */
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, rmSync, cpSync, readFileSync, writeFileSync, statSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../..');
const DEMO_SRC = path.join(HERE, 'demo-site');
const DEMO_SLUG = 'demo-building';

const MOCK_PORT = Number(process.env.CAPTURE_MOCK_PORT ?? 1881);
const PORT = Number(process.env.CAPTURE_PORT ?? 5199);
const HOLD_MS = Number(process.env.CAPTURE_HOLD_MS ?? 9000);
/** The hour of the fixture's day to freeze at: late enough to be busy, early enough to be a workday. */
const TARGET_HOUR = Number(process.env.CAPTURE_HOUR ?? 10.25);
const VIEWPORT = { width: 1440, height: 900 };

/** `height` overrides the viewport where a page needs more of itself to make sense. */
const PAGES = [
  { id: 'overview', out: 'shot-overview' },
  { id: 'analytics', out: 'shot-analytics' },
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
/** The smallest transparent GIF there is. It only has to exist and be slow. */
const PIXEL = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * The `Etc/GMT±N` zone in which right now is about `TARGET_HOUR`, and its offset in minutes.
 *
 * `Etc/GMT+N` is UTC MINUS N — the POSIX sign convention, inverted from the one everybody
 * expects, and getting it backwards puts the fixture twenty hours from where you asked for it.
 */
function fixtureZone(now = new Date()) {
  const utcHour = now.getUTCHours() + now.getUTCMinutes() / 60;
  let offsetHours = Math.round(TARGET_HOUR - utcHour);
  if (offsetHours > 12) offsetHours -= 24;
  if (offsetHours < -11) offsetHours += 24;
  return {
    zone: `Etc/GMT${offsetHours <= 0 ? '+' : '-'}${Math.abs(offsetHours)}`,
    offsetMinutes: offsetHours * 60,
  };
}

function which(...bins) {
  for (const bin of bins) {
    try {
      return execFileSync('which', [bin], { encoding: 'utf8' }).trim();
    } catch {
      /* next */
    }
  }
  return null;
}

function run(bin, args, opts = {}) {
  return new Promise((resolve) => {
    const child = spawn(bin, args, opts);
    const timer = opts.timeout ? setTimeout(() => child.kill('SIGTERM'), opts.timeout) : null;
    child.on('error', (error) => (clearTimeout(timer), resolve({ status: null, signal: null, error })));
    child.on('exit', (status, signal) => (clearTimeout(timer), resolve({ status, signal, error: null })));
  });
}

/** A checkout of HEAD, with the demo site dropped in and made active. Never the real tree. */
function makeWorktree(dir) {
  const r = spawnSync('git', ['worktree', 'add', '--detach', '--force', dir, 'HEAD'], { cwd: REPO, stdio: ['ignore', 'ignore', 'inherit'] });
  if (r.status !== 0) throw new Error('git worktree add failed');

  // Installing again would take minutes on a Pi for a tree that is byte-identical.
  const modules = path.join(dir, 'node_modules');
  if (!existsSync(modules)) spawnSync('ln', ['-s', path.join(REPO, 'node_modules'), modules]);

  const site = path.join(dir, 'shared', 'sites', DEMO_SLUG);
  cpSync(DEMO_SRC, site, { recursive: true });

  // The committed demo site says UTC, because that is the honest default for an example nobody
  // has placed yet. Here it is moved to whichever zone makes right now a working morning — and
  // `test/site-config.test.mjs` asserts a site's timezone and its offset agree, so both change.
  const siteFile = path.join(site, 'site.mjs');
  writeFileSync(
    siteFile,
    readFileSync(siteFile, 'utf8')
      .replace(/timezone: '[^']*'/, `timezone: '${TZ.zone}'`)
      .replace(/utc_offset_minutes: -?\d+/, `utc_offset_minutes: ${TZ.offsetMinutes}`),
  );
  writeFileSync(
    path.join(dir, 'shared', 'siteConfig.mjs'),
    `// Written by docs/assets/capture.mjs inside a throwaway worktree. Not your checkout.\n` +
      `export { SITE } from './sites/${DEMO_SLUG}/site.mjs';\n` +
      `export { CIRCUITS } from './sites/${DEMO_SLUG}/circuits.mjs';\n` +
      `export { BUILT_IN_DEVICES } from './sites/${DEMO_SLUG}/devices.mjs';\n`,
  );

  // The framework's own conformance check, run against the demo building. If the example site
  // shipped alongside the docs is not coherent, the screenshots are the least of it.
  const check = spawnSync('node', ['scripts/site-check.mjs'], { cwd: dir, encoding: 'utf8' });
  if (check.status !== 0) throw new Error(`the demo site fails site:check:\n${check.stdout}${check.stderr}`);
  console.log('  demo site passes site:check');
}

function build(worktree, outDir) {
  const env = {
    ...process.env,
    // Empty, not absent: Vite reads the repository's own `.env` otherwise.
    VITE_SUPABASE_URL: '',
    VITE_SUPABASE_ANON_KEY: '',
    VITE_BRIDGE_HTTP_URL: `http://127.0.0.1:${MOCK_PORT}/api`,
    VITE_BRIDGE_WS_URL: `ws://127.0.0.1:${MOCK_PORT}/ws/live`,
  };
  const r = spawnSync('npx', ['vite', 'build', '--outDir', outDir, '--emptyOutDir'], {
    cwd: worktree,
    env,
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  if (r.status !== 0) throw new Error('vite build failed');
  if (/supabase\.co/.test(readFileSync(path.join(outDir, 'index.html'), 'utf8'))) {
    throw new Error('the built index.html names a Supabase project — refusing to screenshot it');
  }
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
    // Anything that is not a real file is the SPA's index — the routes are hashes, but a stray
    // path must not 404 into a blank screenshot.
    const file = path.join(root, path.normalize(url.pathname));
    if (!file.startsWith(root) || !existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(200, { 'content-type': MIME['.html'] }).end(index);
      return;
    }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream' }).end(readFileSync(file));
  });
  return new Promise((resolve) => server.listen(PORT, '127.0.0.1', () => resolve(server)));
}

async function reachable(url, tries = 40) {
  for (let i = 0; i < tries; i++) {
    try {
      if ((await fetch(url, { signal: AbortSignal.timeout(3000) })).ok) return true;
    } catch {
      /* not up yet */
    }
    await sleep(500);
  }
  return false;
}

/**
 * A profile per shot: Firefox restores the previous session into a reused one, which turned the
 * second page's launch into a hang. The WebGL prefs are an attempt at the 3D view in a browser
 * with no GPU; when they do not take, the app draws its own documented 2D fallback.
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

const requested = process.argv.slice(2);
const pages = requested.length ? PAGES.filter((p) => requested.includes(p.id)) : PAGES;
if (!pages.length) throw new Error(`no such page — known: ${PAGES.map((p) => p.id).join(', ')}`);

const firefox = which('firefox', 'firefox-esr');
if (!firefox) throw new Error('no Firefox found — see this file’s header for why it is not Chromium');

const TZ = fixtureZone();
const work = mkdtempSync(path.join(tmpdir(), 'ibems-capture-'));
const worktree = path.join(work, 'tree');
const dist = path.join(work, 'dist');
let mock;
let server;
try {
  console.log('worktree from HEAD, with the demo building made active…');
  makeWorktree(worktree);

  console.log(`mock bridge on :${MOCK_PORT} (fixture clock ${TZ.zone}, ~${TARGET_HOUR}h)…`);
  mock = spawn('node', [path.join(worktree, 'mock-bridge', 'server.mjs'), `--port=${MOCK_PORT}`, '--dispatch=switch'], {
    cwd: worktree,
    env: { ...process.env, TZ: TZ.zone },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  if (!(await reachable(`http://127.0.0.1:${MOCK_PORT}/api/readings/latest`))) {
    throw new Error(`the mock never answered on :${MOCK_PORT}`);
  }

  console.log('building (Supabase forced empty)…');
  build(worktree, dist);
  server = await serve(dist);
  console.log(`serving on http://127.0.0.1:${PORT}\n`);

  let total = 0;
  for (const page of pages) {
    const out = path.join(HERE, `${page.out}.png`);
    const height = page.height ?? VIEWPORT.height;
    const r = await run(
      firefox,
      [
        '--headless',
        '--profile', makeProfile(path.join(work, `profile-${page.id}`)),
        '--window-size', `${VIEWPORT.width},${height}`,
        '--screenshot', out,
        `http://127.0.0.1:${PORT}/#${page.id}`,
      ],
      { stdio: ['ignore', 'ignore', 'ignore'], timeout: 180_000 },
    );
    if (r.status !== 0 || !existsSync(out)) {
      throw new Error(`${page.id}: Firefox wrote no screenshot — status=${r.status} signal=${r.signal} error=${r.error?.message ?? 'none'}`);
    }
    const bytes = statSync(out).size;
    total += bytes;
    console.log(`  ${path.relative(process.cwd(), out).padEnd(34)} ${VIEWPORT.width}x${height}  ${(bytes / 1024).toFixed(0)} KB`);
  }
  console.log(`\n${(total / 1024).toFixed(0)} KB written`);
} finally {
  server?.close();
  mock?.kill();
  // `--force`, because the worktree has modifications by design and git will not remove it otherwise.
  spawnSync('git', ['worktree', 'remove', '--force', worktree], { cwd: REPO, stdio: 'ignore' });
  rmSync(work, { recursive: true, force: true });
}
