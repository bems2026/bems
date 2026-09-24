#!/usr/bin/env node
/**
 * Scans the manual for identifiers and secrets that must never be published (G1, G2).
 *
 *     node scripts/docs-scan.mjs                 # scans docs/
 *     node scripts/docs-scan.mjs --root <dir>    # scans another tree (the tests use this)
 *     node scripts/docs-scan.mjs --today <date>  # fixes "today" for the staleness warning
 *
 * WHAT IT LOOKS FOR, in every `.md` and `.mmd` file: IPv4 and IPv6 addresses, mesh-network host
 * names, database host names, signed tokens, database keys, private-key blocks and email
 * addresses. Loopback, the wildcard address and the reserved documentation ranges are allowed,
 * because the manual uses them on purpose.
 *
 * IT NEVER PRINTS WHAT IT FOUND. Each hit is reported as `file:line: pattern`. Printing the value
 * into a public CI log would publish it a second time.
 *
 * IT WARNS, AND DOES NOT FAIL, when a page's `last_verified` is more than 90 days old. A stale
 * page is a prompt to re-check it, not a broken build.
 *
 * `docs/audit/raw/` is skipped. It holds raw captures, is ignored by git, and so never reaches
 * a clone. The scanner has no site-specific values in it: the repository is public, and a
 * scanner that listed the secrets it looks for would be the leak.
 *
 * No dependencies, like the rest of `scripts/`.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const STALE_AFTER_DAYS = 90;

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const root = arg('--root', join(REPO, 'docs'));
const today = arg('--today', new Date().toISOString().slice(0, 10));

const ALLOWED_V4 = [/^127\./, /^0\.0\.0\.0$/, /^192\.0\.2\./, /^198\.51\.100\./, /^203\.0\.113\./];
const OCTET = '(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)';
const V4 = new RegExp(`(?<![\\d.])(?:${OCTET}\\.){3}${OCTET}(?![\\d]|\\.\\d)`, 'g');
const V6_CANDIDATE = /(?<![0-9A-Za-z:])(?:[0-9A-Fa-f]{0,4}:){2,7}[0-9A-Fa-f]{0,4}(?![0-9A-Za-z:])/g;
const RESERVED_EMAIL_DOMAIN = /(^|\.)(example\.(com|org|net)|example|invalid|test|localhost)$/i;

/** Each returns true for a hit. None may return the value. */
const CHECKS = [
  ['ipv4', (line) => [...line.matchAll(V4)].some((m) => !ALLOWED_V4.some((re) => re.test(m[0])))],
  [
    'ipv6',
    (line) =>
      [...line.matchAll(V6_CANDIDATE)].some(({ 0: v }) => {
        const colons = (v.match(/:/g) ?? []).length;
        const looksLikeAddress = v.includes('::') || colons === 7;
        if (!looksLikeAddress || !/[0-9A-Fa-f]/.test(v)) return false;
        return !(/^::1?$/.test(v) || /^2001:0?db8(:|$)/i.test(v));
      }),
  ],
  ['mesh host', (line) => /\b[a-z0-9-]+\.ts\.net\b/i.test(line)],
  ['database host', (line) => /\b[a-z0-9]{20}\.supabase\.(co|in)\b/i.test(line)],
  ['signed token', (line) => /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/.test(line)],
  ['database key', (line) => /\bsb_(secret|publishable)_[A-Za-z0-9_-]{16,}/.test(line)],
  ['private key', (line) => /-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(line)],
  [
    'email',
    (line) =>
      [...line.matchAll(/\b[A-Za-z0-9._%+-]+@((?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,})\b/g)].some(
        (m) => !RESERVED_EMAIL_DOMAIN.test(m[1]),
      ),
  ],
];

function* files(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const rel = relative(root, path).split('\\').join('/');
    if (rel === 'audit/raw' || rel.startsWith('audit/raw/') || name === 'node_modules' || name.startsWith('.')) continue;
    if (statSync(path).isDirectory()) yield* files(path);
    else if (/\.(md|mmd)$/.test(name)) yield { path, rel };
  }
}

function daysBetween(from, to) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

let hits = 0;
let scanned = 0;
for (const { path, rel } of files(root)) {
  scanned++;
  const text = readFileSync(path, 'utf8');
  text.split(/\r?\n/).forEach((line, i) => {
    for (const [name, hit] of CHECKS) {
      if (hit(line)) {
        hits++;
        console.log(`${rel}:${i + 1}: ${name}`);
      }
    }
  });
  const verified = text.match(/^last_verified:\s*(\d{4}-\d{2}-\d{2})\s*$/m);
  if (verified && text.startsWith('---')) {
    const age = daysBetween(verified[1], today);
    if (age > STALE_AFTER_DAYS) console.log(`${rel}: warn: last_verified ${verified[1]} is ${age} days old`);
  }
}

console.log(`docs-scan: ${scanned} file(s), ${hits} hit(s)`);
process.exitCode = hits ? 1 : 0;
