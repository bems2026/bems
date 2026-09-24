/**
 * `scripts/docs-scan.mjs` — the manual must never publish an identifier or a secret (G1, G2).
 *
 * WHY THIS EXISTS. The repository is public, and the manual is its most-read part. During the
 * manual's own build, a hand-run scan found two real Wi-Fi names in a runbook and real private
 * addresses in two test fixtures, both already committed. A scan that runs in CI is what keeps
 * the next one out.
 *
 * FIXTURES ARE BUILT AT RUNTIME, from pieces joined here, so this file never contains a literal
 * the scanner would flag. That keeps the scanner free to scan the whole tree one day without
 * tripping over its own test.
 *
 * THE SCANNER NEVER PRINTS WHAT IT FOUND. It names the file, the line and the pattern. Echoing
 * a leaked key into a public CI log would be the leak a second time.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCANNER = join(ROOT, 'scripts', 'docs-scan.mjs');

const dot = (...p) => p.join('.');
const colon = (...p) => p.join(':');
const FRONT = (date) => `---\ntitle: T\nlast_verified: ${date}\n---\n\n# T\n\n`;

function scan(files, args = []) {
  const dir = mkdtempSync(join(tmpdir(), 'docs-scan-'));
  try {
    for (const [name, body] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, name)), { recursive: true });
      writeFileSync(join(dir, name), body);
    }
    const r = spawnSync(process.execPath, [SCANNER, '--root', dir, '--today', '2026-09-24', ...args], { encoding: 'utf8' });
    return { code: r.status, out: `${r.stdout}${r.stderr}` };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('a clean page passes', () => {
  const r = scan({ 'a.md': `${FRONT('2026-09-20')}Nothing to see here.\n` });
  assert.equal(r.code, 0, r.out);
});

test('a private IPv4 address fails, and the address is never printed', () => {
  const ip = dot('10', '42', '7', '19');
  const r = scan({ 'a.md': `${FRONT('2026-09-20')}The edge is at ${ip}.\n` });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /a\.md:8: ipv4/);
  assert.equal(r.out.includes(ip), false, 'the scanner printed the value it found');
});

test('loopback, the wildcard and the documentation ranges are allowed', () => {
  const ok = [dot('127', '0', '0', '1'), dot('0', '0', '0', '0'), dot('192', '0', '2', '10'), dot('198', '51', '100', '7'), dot('203', '0', '113', '5')];
  const r = scan({ 'a.md': `${FRONT('2026-09-20')}${ok.join(' and ')}\n` });
  assert.equal(r.code, 0, r.out);
});

test('a three-part version number is not an address', () => {
  const r = scan({ 'a.md': `${FRONT('2026-09-20')}Node.js 22.23.2 and tuyapi 7.7.1\n` });
  assert.equal(r.code, 0, r.out);
});

test('a global IPv6 address fails; loopback and the documentation prefix do not', () => {
  const bad = colon('2400', 'cb00', '1f', '', '9');
  assert.equal(scan({ 'a.md': `${FRONT('2026-09-20')}${bad}\n` }).code, 1);
  const good = `${colon('', '', '1')} and ${colon('2001', 'db8', '', '1')}`;
  assert.equal(scan({ 'a.md': `${FRONT('2026-09-20')}${good}\n` }).code, 0);
});

test('a clock time is not an IPv6 address', () => {
  const r = scan({ 'a.md': `${FRONT('2026-09-20')}At 07:40:00 and 12:30 the rule fires.\n` });
  assert.equal(r.code, 0, r.out);
});

test('mesh host names, database hosts, tokens and private keys fail', () => {
  const cases = {
    'ts.md': `${dot('edge', 'tail' + 'abc123', 'ts', 'net')}`,
    'sb.md': `https://${'abcdefghijklmnopqrst'}.${dot('supabase', 'co')}`,
    'jwt.md': `${'ey' + 'J'}${'x'.repeat(20)}.${'y'.repeat(20)}.${'z'.repeat(10)}`,
    'key.md': `-----BEGIN ${'PRIVATE'} KEY-----`,
    'sk.md': `${'sb_' + 'secret_'}${'a'.repeat(24)}`,
  };
  for (const [name, body] of Object.entries(cases)) {
    const r = scan({ [name]: `${FRONT('2026-09-20')}${body}\n` });
    assert.equal(r.code, 1, `${name} passed: ${r.out}`);
    assert.equal(r.out.includes(body), false, `${name}: the value was printed`);
  }
});

test('an email address fails unless it is at a reserved example domain', () => {
  const bad = `someone@${dot('uni', 'edu', 'ph')}`;
  assert.equal(scan({ 'a.md': `${FRONT('2026-09-20')}${bad}\n` }).code, 1);
  const good = `someone@${dot('example', 'com')}`;
  assert.equal(scan({ 'a.md': `${FRONT('2026-09-20')}${good}\n` }).code, 0);
});

test('a page verified more than 90 days ago warns but does not fail', () => {
  const r = scan({ 'old.md': `${FRONT('2026-05-01')}Content.\n` });
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /old\.md: warn: last_verified 2026-05-01 is 146 days old/);
});

test('diagram sources are scanned too', () => {
  const ip = dot('172', '16', '0', '9');
  const r = scan({ 'diagrams/x.mmd': `flowchart LR\n  a["${ip}"]\n` });
  assert.equal(r.code, 1, r.out);
});

test('the raw audit captures are never scanned, because they are never committed', () => {
  const ip = dot('10', '0', '0', '8');
  const r = scan({ 'audit/raw/capture.md': `${ip}\n` });
  assert.equal(r.code, 0, r.out);
});

test('the manual as committed passes', () => {
  const r = spawnSync(process.execPath, [SCANNER], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
});
