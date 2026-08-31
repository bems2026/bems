/**
 * No tracked source file may contain a stray control character.
 *
 * WHY THIS EXISTS, and it is a scar with a very specific shape. Three guards in this suite were
 * written by piping text through a shell, which turned the intended `\b` — a regex word
 * boundary, two characters — into a literal BACKSPACE (0x08, one character). The regexes still
 * parsed. They simply could never match anything, so every assertion built on them was trivially
 * true, including the guard written to stop a bug recurring, which had been silently asserting
 * nothing since the day it was added. One of the three, once repaired, immediately found a real
 * violation it had been sitting on.
 *
 * WHAT CAUGHT IT AND WHAT DID NOT. eslint's `no-control-regex` caught it — in CI, two commits
 * later. Nothing caught the vacuity, because a test that cannot fail looks exactly like a test
 * that passes. And eslint only reads JavaScript: the same shell trap could put a backspace into
 * a `.sql` migration, a `.sh` installer or a `.md` runbook, where nothing would ever look.
 *
 * So this is deliberately broader than a linter and narrower than a style rule. It says only
 * that bytes nobody typed on purpose should not be in the source.
 *
 * TAB, CR and LF are excluded — this repository has files in both line endings, and that is a
 * separate argument. Everything else in C0, plus DEL, is a mistake.
 *
 * A DELIBERATE control character should be written as an ESCAPE, not as a raw byte:
 * `node-red-bridge/bridgeSignature.mjs` uses NUL as a sort-key separator and now spells it
 * `'\0'`. Same character at runtime — the signature hash is byte-identical, checked — but a byte
 * a reader can see, a diff can show, and a copy-paste cannot lose.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** C0 controls except tab (09), LF (0a) and CR (0d), plus DEL (7f). Written as escapes, for the
 * reason in the header — and because raw ones here would trip eslint's `no-irregular-whitespace`,
 * which is how the first draft of this very file was caught. */
// eslint-disable-next-line no-control-regex -- finding these is the entire point of this file
const CONTROL = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/;

/** Binary and vendored files have their own bytes and are none of this test's business. */
const SKIP = /\.(png|jpe?g|gif|ico|woff2?|ttf|eot|xlsx|pdf|zip)$/i;

function trackedTextFiles() {
  let out;
  try {
    out = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
  return out.split('\n').filter((f) => f && !SKIP.test(f));
}

test('the matcher itself works, before anything is believed about the repository', () => {
  // The failure this guards against is a matcher that cannot fire. Proving that this one does is
  // the lesson of the bug it exists for, applied to itself.
  assert.equal(CONTROL.test(`a${String.fromCharCode(8)}b`), true, 'a backspace must be detected');
  assert.equal(CONTROL.test(`a${String.fromCharCode(0)}b`), true, 'a NUL must be detected');
  assert.equal(CONTROL.test('plain text\twith\ttabs'), false, 'tabs are fine');
  assert.equal(CONTROL.test('lines\nand\r\nreturns'), false, 'newlines are fine');
});

test('no tracked source file contains a stray control character', () => {
  const files = trackedTextFiles();
  if (files === null) {
    console.log('    (git not available here — skipped)');
    return;
  }
  assert.ok(files.length > 100, `expected the tracked file list, got ${files.length}`);

  const offenders = [];
  for (const file of files) {
    let text;
    try {
      text = readFileSync(join(ROOT, file), 'utf8');
    } catch {
      continue; // unreadable, or removed between listing and reading
    }
    if (!CONTROL.test(text)) continue;
    const line = text.split('\n').findIndex((l) => CONTROL.test(l)) + 1;
    const codes = [...new Set([...text].filter((c) => CONTROL.test(c)).map((c) => `0x${c.charCodeAt(0).toString(16).padStart(2, '0')}`))];
    offenders.push(`${file}:${line} contains ${codes.join(', ')}`);
  }

  assert.deepEqual(
    offenders,
    [],
    'A control character in source is almost always a shell that ate a backslash — `\\b` ' +
      'becoming 0x08 is the one this repository has already paid for. Write it as an escape.',
  );
});
