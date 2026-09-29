/**
 * The runtime the archive stands on (RM-148): `node:sqlite`, built into Node since 22.13 without a
 * flag. The Pi runs Node 22 and development runs 24 (CI tests both). A downgrade, or an install
 * that pins an older 22.x, would take the archive away — and ingest would quietly fall back to
 * writing straight to the cloud. This says so in a test, by name, before that reaches the Pi.
 *
 * A dynamic import on purpose: a static one would fail this file at load time with a bare
 * module-resolution error instead of the sentence below.
 *
 *     node --test server/archiveRuntime.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('this Node carries SQLite, which the Pi archive needs', async () => {
  let mod;
  try {
    mod = await import('node:sqlite');
  } catch (err) {
    assert.fail(`node:sqlite is not available on Node ${process.version} (${err.code ?? err.message}). The archive (server/archiveDb.mjs) needs Node 22.13 or later.`);
  }
  const db = new mod.DatabaseSync(':memory:');
  const { v } = db.prepare('SELECT sqlite_version() AS v').get();
  db.close();
  // STRICT tables arrived in SQLite 3.37; every Node that ships node:sqlite is far past it, but the
  // archive's schema depends on it, so the floor is written down here rather than assumed.
  const [major, minor] = v.split('.').map(Number);
  assert.ok(major > 3 || (major === 3 && minor >= 37), `SQLite ${v} predates STRICT tables (3.37)`);
});
