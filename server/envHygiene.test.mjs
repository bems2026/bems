/**
 * Guards the boundary between "a module that does a job" and "a module that reconfigures the
 * process". Importing a route must not touch `process.env`.
 *
 * WHY THIS EXISTS: `enrollRoute.mjs` and `removeRoute.mjs` both called `loadDotEnv(...)` at
 * module top level, so `import`ing either one — which `proxy.mjs` does — loaded every value in
 * `server/.env` into the process, `TUYA_ACCESS_SECRET` included. CLAUDE.md names that the most
 * sensitive credential in this system, ahead of the service-role key, because it reaches
 * hardware directly and no RLS scopes it.
 *
 * The louder cost was the test suite. Five proxy tests set up a deployment with NO credentials
 * and assert it degrades honestly — 501 from `/api/tuya/devices`, the dispatch gate closed by
 * default. On the Pi those tests got the Pi's REAL configuration instead of the empty one they
 * built, so they failed there and passed on a workstation. The Pi is exactly where
 * `docs/pi-session-brief.md` says to run the suite before deploying, so the effect was to
 * normalise five red tests — and the next real regression would have hidden among them.
 *
 * Environment belongs to entrypoints: `proxy.mjs` gets it from the systemd unit's
 * `EnvironmentFile`, and the CLIs load it themselves. A library module must inherit, never
 * acquire.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROUTE_MODULES = ['enrollRoute.mjs', 'removeRoute.mjs'];

/**
 * Imports a module in a clean child process and reports which env keys it added.
 *
 * A child, not this process: the runner's own environment is already whatever the developer's
 * shell holds, and the modules are cached after the first import, so an in-process check would
 * measure the wrong thing and only work once.
 */
function envKeysAddedByImporting(moduleFile) {
  const script = `
    const before = new Set(Object.keys(process.env));
    await import(${JSON.stringify(join(HERE, moduleFile))});
    console.log(JSON.stringify(Object.keys(process.env).filter((k) => !before.has(k))));
  `;
  const out = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
    encoding: 'utf8',
    cwd: join(HERE, '..'),
  });
  return JSON.parse(out.trim().split('\n').pop());
}

for (const moduleFile of ROUTE_MODULES) {
  test(`importing ${moduleFile} does not put anything into process.env`, () => {
    const added = envKeysAddedByImporting(moduleFile);
    assert.deepEqual(added, [], `${moduleFile} added ${added.join(', ')} to the environment on import`);
  });
}

/**
 * The source-level half. The behavioural test above can only fail on a machine that HAS a
 * `server/.env` to leak — on a workstation without one, `loadDotEnv` is a silent no-op and the
 * assertion passes vacuously. That is precisely backwards: the guard would be asleep everywhere
 * except the one machine where the bug bites. This half fails anywhere.
 */
test('no route module calls loadDotEnv at module scope', () => {
  for (const moduleFile of ROUTE_MODULES) {
    const src = readFileSync(join(HERE, moduleFile), 'utf8');
    const topLevelCalls = src
      .split('\n')
      .filter((line) => /^\s*loadDotEnv\s*\(/.test(line));
    assert.deepEqual(
      topLevelCalls,
      [],
      `${moduleFile} calls loadDotEnv at module scope: ${topLevelCalls.join(' | ')}`,
    );
  }
});

/**
 * The deployment assumption this fix rests on. If the unit ever loses its EnvironmentFile, the
 * proxy silently starts with no credentials and the failure surfaces as "the vendor cloud could
 * not be reached" — a wrong diagnosis this project has already chased once.
 */
test('the proxy unit supplies the environment the route modules no longer load', () => {
  const unit = join(HERE, 'ibems-proxy.service');
  if (!existsSync(unit)) return; // unit file not shipped in every checkout
  assert.match(
    readFileSync(unit, 'utf8'),
    /^EnvironmentFile=.*\.env\s*$/m,
    'ibems-proxy.service must load server/.env, since proxy.mjs no longer does it by side effect',
  );
});
