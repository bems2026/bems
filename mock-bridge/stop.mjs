/**
 * Stops a mock bridge left listening on a port.
 *
 *     npm run mock:stop [-- --port=1880]
 *
 * Exists because a stale mock holding the port makes a fresh `npm run mock` fail with
 * EADDRINUSE, and the old process keeps happily serving old code — which reads as
 * "my edits did nothing" rather than as a bind failure.
 *
 * Only ever kills the process bound to this exact port. It does not go hunting for
 * node processes by name; killing an unrelated dev server would be worse than the
 * problem it solves.
 */

import { execSync } from 'node:child_process';

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

const pids = pidsOnPort();
if (!pids.length) {
  console.log(`nothing listening on :${port}`);
  process.exit(0);
}

for (const pid of pids) {
  try {
    if (isWin) execSync(`taskkill /PID ${pid} /F`, { stdio: 'ignore' });
    else process.kill(Number(pid), 'SIGTERM');
    console.log(`stopped pid ${pid} on :${port}`);
  } catch (e) {
    console.error(`could not stop pid ${pid}: ${e.message}`);
    process.exitCode = 1;
  }
}
