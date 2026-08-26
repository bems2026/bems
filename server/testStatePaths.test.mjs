import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * Guards the boundary between a test's state and the RUNNING SYSTEM's state.
 *
 * `server/data/` holds two live things on the Pi: the outage queue of command audit rows
 * waiting to reach Supabase, and the cached signing keys that make offline verification
 * possible. Both have defaults a spawned child will happily use if nothing overrides them.
 *
 * WHY THIS IS A TEST AND NOT A COMMENT: it already happened. While the scheduler's outage tests
 * were being written, a full-suite run left a fabricated `l1` command in
 * `server/data/command-audit-buffer-scheduler.ndjson` — a row `ingest.mjs` would have uploaded
 * into the production audit trail on the next tick, attributed to a test user. It came from a
 * harness closing its fake Supabase while a command was in flight, which is indistinguishable
 * from a real outage and therefore buffers, exactly as designed.
 *
 * WHY IT READS THE SOURCE. The behavioural version cannot be written reliably: the leak depends
 * on a teardown race that does not reproduce on demand — deleting the fix and re-running the
 * file produced nothing, because the timing was not there. A grep is deterministic where the
 * behaviour is not. Same reasoning as `envHygiene.test.mjs`'s source-level half and
 * `bridgeClientPaths.test.ts`: the mistake is invisible to types, survives a green suite, and
 * only reading the source catches it.
 */

const HERE = dirname(fileURLToPath(import.meta.url));

/** Every env var naming a path under `server/data/`. Additions here need a redirect below. */
const STATEFUL_ENV_VARS = ['COMMAND_AUDIT_BUFFER_PATH', 'SCHEDULER_AUDIT_BUFFER_PATH', 'JWKS_CACHE_PATH'];

const TMPDIR_BUILT = /mkdtempSync\(\s*join\(\s*os\.tmpdir\(\)/;

/**
 * The options object of each spawn, isolated from the rest of the file.
 *
 * SCOPED ON PURPOSE. Written as a whole-file `includes()`, the assertions below passed with the
 * harness redirect deleted — those variable names also appear in individual tests that set them
 * for their own reasons, so grepping the file proved only that the strings exist somewhere. What
 * has to be true is narrower: the SPAWN SITE sets them, because that is the process that would
 * otherwise fall back to the default.
 */
function spawnOptionBlocks(src, marker) {
  const blocks = [];
  let from = 0;
  for (;;) {
    const at = src.indexOf(marker, from);
    if (at === -1) break;
    // Brace-matched, not terminated by a marker word. The obvious version stopped at the next
    // `stdio:`, which lives inside `spawnChild` rather than at its call sites — so a block
    // ran to the end of the file and swallowed every LATER spawn's redirect, making the whole
    // assertion pass when one site was stripped. A block that is too big proves nothing.
    const open = src.indexOf('{', at);
    let depth = 0;
    let end = open;
    for (let i = open; i < src.length; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}') {
        depth--;
        if (depth === 0) {
          end = i + 1;
          break;
        }
      }
    }
    blocks.push(src.slice(open, end));
    from = end;
  }
  return blocks;
}

test('every proxy spawn redirects the paths that would otherwise land in server/data/', () => {
  const src = readFileSync(join(HERE, 'proxy.test.mjs'), 'utf8');
  const blocks = spawnOptionBlocks(src, 'spawnChild(PROXY, {');
  assert.ok(blocks.length >= 2, 'expected both proxy harnesses to spawn a proxy');

  // Applied through a shared helper, so check the helper really covers every variable and then
  // that each spawn actually calls it.
  const helper = src.slice(src.indexOf('function tempStatePaths()'), src.indexOf('async function setup('));
  assert.ok(helper.length > 0, 'tempStatePaths() has gone; the redirects it applied need a new home');
  for (const name of STATEFUL_ENV_VARS) {
    assert.ok(helper.includes(name), `tempStatePaths() does not set ${name}`);
  }
  assert.match(helper, TMPDIR_BUILT, 'tempStatePaths() should build under os.tmpdir(), not inside the repo');

  for (const [i, block] of blocks.entries()) {
    assert.ok(
      block.includes('tempStatePaths()'),
      `proxy spawn #${i + 1} does not redirect its state paths, so it will write into the real server/data/`,
    );
  }
});

test('every scheduler spawn redirects its audit buffer', () => {
  const src = readFileSync(join(HERE, 'scheduler.test.mjs'), 'utf8');
  const blocks = spawnOptionBlocks(src, 'spawn(process.execPath, [SCHEDULER]');
  assert.ok(blocks.length >= 1, 'expected the scheduler harness to spawn a scheduler');
  for (const block of blocks) {
    assert.ok(
      block.includes('SCHEDULER_AUDIT_BUFFER_PATH'),
      'the scheduler spawn does not override SCHEDULER_AUDIT_BUFFER_PATH, so a buffered command lands in the real outage queue',
    );
    assert.match(block, TMPDIR_BUILT, 'the scheduler spawn should build its buffer path under os.tmpdir()');
  }
});

test('the production defaults really do live under server/, which is what makes this matter', () => {
  // If a refactor moved the defaults out of the repo, this guard would be pointless and should
  // be deleted rather than left implying a protection it no longer provides.
  const proxy = readFileSync(join(HERE, 'proxy.mjs'), 'utf8');
  const scheduler = readFileSync(join(HERE, 'scheduler.mjs'), 'utf8');
  assert.match(proxy, /'data', 'command-audit-buffer\.ndjson'/);
  assert.match(proxy, /'data', 'jwks\.json'/);
  assert.match(scheduler, /'data', 'command-audit-buffer-scheduler\.ndjson'/);
});
