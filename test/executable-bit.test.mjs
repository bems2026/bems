/**
 * A shell script this project tells people to run must ship executable.
 *
 * WHY THIS EXISTS. `scripts/install.sh` was committed with mode 100644, so the very first command
 * in `docs/replication.md` — `./scripts/install.sh` — failed for every recipient with
 * `Permission denied`. It was caught by running it on the Pi after a pull, not by review.
 *
 * THE CAUSE IS A WINDOWS DEFAULT, WHICH IS WHY A GUARD IS WORTH IT. `git config core.filemode`
 * is `false` on this project's workstation, so `chmod +x` locally changes the working tree and
 * git records nothing. The file looks executable to the person who wrote it and is not
 * executable to anyone who clones it. Nothing in a normal review shows the difference — the
 * diff, the content and the local `ls -l` all look right.
 *
 * The fix, once, per file: `git update-index --chmod=+x <path>`.
 *
 * This reads the INDEX rather than the filesystem, deliberately: the filesystem is exactly the
 * thing that lies here.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** `git ls-files -s` prints `<mode> <sha> <stage>\t<path>`. */
function trackedShellScripts() {
  let out;
  try {
    out = execFileSync('git', ['ls-files', '-s', '--', '*.sh'], { cwd: ROOT, encoding: 'utf8' });
  } catch (err) {
    // A tarball export or a checkout without git is not a failing repository.
    if (err.code === 'ENOENT') return null;
    throw err;
  }
  return out
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [meta, path] = line.split('\t');
      return { mode: meta.split(' ')[0], path };
    });
}

test('every tracked .sh file is executable in the index', () => {
  const scripts = trackedShellScripts();
  if (scripts === null) {
    console.log('    (git not available here — skipped)');
    return;
  }
  assert.ok(scripts.length > 0, 'expected at least one tracked shell script');

  const notExecutable = scripts.filter((s) => s.mode !== '100755').map((s) => `${s.path} is ${s.mode}`);
  assert.deepEqual(
    notExecutable,
    [],
    'Run: git update-index --chmod=+x <path>. A chmod in the working tree does not record on ' +
      'a machine with core.filemode=false, which is the default on Windows.',
  );
});
