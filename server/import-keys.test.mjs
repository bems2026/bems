/**
 * `npm run keys:import` — the Pi-side way to load a key tool's export, beside Add Device's Import keys.
 *
 * What only the running script decides: that a dry run writes nothing, that `--apply` writes to the
 * path it is given, and that no line it prints carries a key.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, 'import-keys.mjs');
const KEY = 'Qm4!vT9xLp2#Rz7w';

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'ibems-keys-'));
  const file = join(dir, 'export.json');
  writeFileSync(file, JSON.stringify([
    { id: 'bf00000000000000001234', name: 'Outlet 9', local_key: KEY, category: 'pc' },
    { id: 'bf00000000000000005678', name: 'BLE lock', local_key: '-', category: 'ms' },
  ]));
  return { file, store: join(dir, 'device-credentials.json') };
}

const run = (args, store) =>
  execFileSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, DEVICE_CREDENTIALS_PATH: store } });

test('a dry run reports what it would import and writes nothing', () => {
  const { file, store } = fixture();
  const out = run([file], store);
  assert.match(out, /Outlet 9/);
  assert.match(out, /16 chars/);
  assert.match(out, /BLE lock: no local key/);
  assert.match(out, /Dry run/);
  assert.equal(out.includes(KEY), false);
  assert.equal(existsSync(store), false);
});

test('--apply stores the keys, and --complete records that the export is the whole account', () => {
  const { file, store } = fixture();
  const out = run([file, '--apply', '--complete'], store);
  assert.equal(out.includes(KEY), false);
  assert.match(out, /added 1/);
  const saved = JSON.parse(readFileSync(store, 'utf8'));
  assert.equal(saved.devices.bf00000000000000001234.localKey, KEY);
  assert.deepEqual(saved.lastComplete.ids, ['bf00000000000000001234']);
});

test('a file that is not an export exits non-zero with the reason', () => {
  const { store } = fixture();
  const bad = join(dirname(store), 'notes.txt');
  writeFileSync(bad, 'nothing to see');
  assert.throws(() => run([bad, '--apply'], store), (err) => /not a recognised export/.test(String(err.stderr)) && err.status === 1);
});
