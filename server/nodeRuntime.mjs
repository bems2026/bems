/**
 * Which Node runtimes carry the Windows TCP-connect stack buffer overrun — libuv#5107.
 *
 * WHAT IT IS. libuv's Windows `uv__tcp_try_connect` asks `RtlGetVersion()` whether the OS supports
 * fast loopback failure, on EVERY outbound TCP connect, passing an `OSVERSIONINFOW` whose size field
 * was never set. `RtlGetVersion` reads that field to decide how much to write. When leftover stack
 * data happens to hold the size of the larger `OSVERSIONINFOEXW`, it writes past the struct, the /GS
 * stack cookie check fails, and the process is fast-failed with status 0xC0000409: no stderr, no
 * `exit` event, nothing a JavaScript handler can see. Whether it fires depends on what an earlier call
 * left on the stack, so it is rare, intermittent, and far likelier on some call paths than others.
 *
 * HOW IT SHOWED UP HERE. `server/proxy.test.mjs` spawns the proxy, which `fetch`es a fake Supabase
 * while serving a request. Measured 2026-09-17 on the workstation (Node 24.15.0, libuv 1.51.0): the
 * proxy died with 0xC0000409 inside that fetch, Windows reset the test's open connection, and the test
 * reported `TypeError: fetch failed` / `read ECONNRESET` — about one run of the file in thirty, in a
 * different test each time. An idle child, a listen-only child and a single-fetch child did not crash
 * in 1000 spawns each; the proxy with no request did not either.
 *
 * WHERE IT IS FIXED. libuv commit aabb7651de, cherry-picked by nodejs/node#62561 into 24.16.0 and
 * 26.1.0, and present in every line branched after it. It was never backported to 22.x, and 25.x
 * reached end of life without it. The unfixed code goes back at least to libuv 1.40, so everything
 * earlier on Windows is treated as affected.
 */

/** First release carrying the fix, per release line that received it. */
const FIXED_FROM = { 24: [24, 16, 0], 26: [26, 1, 0] };
/** Lines branched from main after the fix landed, so every release on them has it. */
const FIRST_LINE_WITH_FIX = 27;

export function hasWindowsLoopbackOverrun({ platform, version }) {
  if (platform !== 'win32') return false;
  const parts = /^v?(\d+)\.(\d+)\.(\d+)/.exec(version)?.slice(1).map(Number);
  if (!parts) return true; // an unreadable version cannot be shown to be clear
  if (parts[0] >= FIRST_LINE_WITH_FIX) return false;
  const fixed = FIXED_FROM[parts[0]];
  if (!fixed) return true;
  for (let i = 0; i < 3; i++) {
    if (parts[i] !== fixed[i]) return parts[i] < fixed[i];
  }
  return false;
}
