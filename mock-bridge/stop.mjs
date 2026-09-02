/**
 * Stops a mock bridge left listening on a port.
 *
 *     npm run mock:stop [-- --port=1880]
 *
 * Exists because a stale mock holding the port makes a fresh `npm run mock` fail with
 * EADDRINUSE, and the old process keeps happily serving old code — which reads as
 * "my edits did nothing" rather than as a bind failure.
 *
 * Only ever kills the process bound to this exact port, AND only if that process is a mock
 * bridge. Killing an unrelated server would be worse than the problem it solves — and on
 * 2026-09-02 it was: on the Pi, port 1880 belongs to the live Node-RED bridge, so running this
 * there SIGTERMed production. The dashboard, the ingestion daemon and the scheduler all lost
 * their data source, and nothing said why. `npm run mock` fails to bind on that same box, so
 * reaching for `mock:stop` is the natural next move rather than an unlikely mistake.
 *
 * `--force` overrides the check for the case where a mock has been renamed or wrapped.
 */

import { execSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

/**
 * Is this process actually a mock bridge?
 *
 * Matched on the command line rather than on a pidfile, because the thing being guarded against
 * is a process this script never started. Node-RED's command line names `node-red`; the mock's
 * names `mock-bridge`. Anything else is unknown and therefore not ours to kill.
 */
export function looksLikeMock(cmdline) {
  return /mock-bridge/.test(String(cmdline ?? ''));
}

function cmdlineOf(pid) {
  try {
    if (process.platform === 'linux') {
      return execSync(`tr '\\0' ' ' < /proc/${pid}/cmdline`, { encoding: 'utf8' }).trim();
    }
    return execSync(`ps -p ${pid} -o args=`, { encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}

const port = Number((process.argv.find((a) => a.startsWith('--port=')) || '--port=1880').split('=')[1]);
const isWin = process.platform === 'win32';

function pidsOnPort() {
  try {
    if (isWin) {
      const out = execSync(`netstat -ano -p tcp`, { encoding: 'utf8' });
      return [...new Set(
        out.split('\n')
          .filter((l) => /LISTENING/.test(l) && new RegExp(`[:.]${port}\\s`).test(l))
          .map((l) => l.trim().split(/\s+/).pop())
          .filter((p) => p && p !== '0')
      )];
    }
    return execSync(`lsof -ti tcp:${port} -sTCP:LISTEN`, { encoding: 'utf8' }).split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

// Importing this module must not kill anything — the guard above has a test, and a test that
// stops the live bridge on import would be the exact failure it exists to prevent.
const RUN_AS_CLI = import.meta.url === pathToFileURL(process.argv[1] ?? '').href;
if (!RUN_AS_CLI) { /* imported for `looksLikeMock`; do nothing */ } else {

const pids = pidsOnPort();
if (!pids.length) {
  console.log(`nothing listening on :${port}`);
  process.exit(0);
}

const FORCE = process.argv.includes('--force');

for (const pid of pids) {
  const cmd = cmdlineOf(pid);
  if (!FORCE && !looksLikeMock(cmd)) {
    console.error(`REFUSING to stop pid ${pid} on :${port} — it is not a mock bridge.`);
    console.error(`  ${cmd || '(command line unreadable)'}`);
    console.error('On the Pi this port is the live Node-RED bridge, and stopping it takes the');
    console.error('dashboard, ingestion and scheduler down with it. Use --force only if you are');
    console.error('certain, or pick another port: npm run mock -- --port=1881');
    process.exitCode = 1;
    continue;
  }
  try {
    if (isWin) execSync(`taskkill /PID ${pid} /F`, { stdio: 'ignore' });
    else process.kill(Number(pid), 'SIGTERM');
    console.log(`stopped pid ${pid} on :${port}`);
  } catch (e) {
    console.error(`could not stop pid ${pid}: ${e.message}`);
    process.exitCode = 1;
  }
}

}
