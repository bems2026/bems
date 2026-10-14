#!/usr/bin/env node
/**
 * Sets the account a local sign-in commands as (`BREAK_GLASS_USER_ID`, ADR-0016) — RM-161.
 *
 *     npm run local-control:account              # list the accounts that have sent commands
 *     npm run local-control:account -- --write   # write the newest one into server/.env
 *     npm run local-control:account -- --write=<id>
 *
 * Needs the internet: it asks the database, with the service key from server/.env, which accounts
 * have sent commands from the app, newest first, and confirms each is still an account.
 *
 * WHY THIS EXISTS. The id is 36 characters, set once, usually at the edge's own console. One wrong
 * character still looks like an id, so the proxy accepts it; then every local command's record is
 * refused by the database (the id names no account), and the refused record sits at the head of the
 * outage queue holding back every record behind it. So the id is looked up and written, never typed.
 *
 * Writes only that one line, replacing it if present. Restart the proxy afterwards.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadDotEnv } from '../node-red-bridge/nodeRedAdmin.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
loadDotEnv(path.join(HERE, '..'));
loadDotEnv(HERE);

const ENV_PATH = process.env.LOCAL_CONTROL_ENV_PATH || path.join(HERE, '.env');
const writeArg = process.argv.find((a) => a === '--write' || a.startsWith('--write='));
const chosenId = writeArg?.startsWith('--write=') ? writeArg.slice('--write='.length).toLowerCase() : null;

const url = process.env.SUPABASE_URL?.replace(/\/+$/, '');
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in server/.env');
  process.exit(2);
}

const get = (p) =>
  fetch(`${url}${p}`, { headers: { apikey: key, Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(10_000) });

let rows;
try {
  const res = await get('/rest/v1/commands?select=requested_by,requested_at&source=eq.ibems-app&requested_by=not.is.null&order=requested_at.desc&limit=500');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  rows = await res.json();
} catch (err) {
  console.error(`Cannot reach the database (${err?.message ?? err}). This needs the internet: run it while the edge is online.`);
  process.exit(1);
}

/** Newest first, one entry per account, with how many commands it sent in what was read. */
const byId = new Map();
for (const r of rows) {
  const id = String(r.requested_by).toLowerCase();
  const seen = byId.get(id);
  if (seen) seen.count += 1;
  else byId.set(id, { id, last: r.requested_at, count: 1 });
}

const accounts = [];
for (const candidate of byId.values()) {
  try {
    const res = await get(`/auth/v1/admin/users/${encodeURIComponent(candidate.id)}`);
    if (!res.ok) continue; // no longer an account: never offered
    const user = await res.json();
    accounts.push({ ...candidate, email: user.email ?? '(no email)' });
  } catch {
    console.error('Cannot reach the database to confirm the accounts. This needs the internet: run it while the edge is online.');
    process.exit(1);
  }
}

if (accounts.length === 0) {
  console.error('No account has sent a command from the app yet, so there is none to offer. Sign in and switch something once, then run this again.');
  process.exit(1);
}

console.log('Accounts that have sent commands from the app, newest first:');
for (const a of accounts) console.log(`  ${a.id}  ${a.email}  last ${a.last}  (${a.count} command${a.count === 1 ? '' : 's'})`);

if (!writeArg) {
  console.log('\nNothing written. Add --write to use the first, or --write=<id> for another.');
  process.exit(0);
}

const target = chosenId ? accounts.find((a) => a.id === chosenId) : accounts[0];
if (!target) {
  console.error(`\n${chosenId} is not one of the accounts listed above. Nothing written.`);
  process.exit(1);
}

let text = '';
try { text = fs.readFileSync(ENV_PATH, 'utf8'); } catch { /* a new file */ }
const eol = text.includes('\r\n') ? '\r\n' : '\n';
const line = `BREAK_GLASS_USER_ID=${target.id}`;
const lines = text.split(/\r?\n/);
const at = lines.findIndex((l) => /^\s*BREAK_GLASS_USER_ID\s*=/.test(l));
if (at >= 0) lines[at] = line;
else {
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  lines.push(line, '');
}
fs.writeFileSync(ENV_PATH, lines.join(eol));

console.log(`\nWrote ${line} (${target.email}) to ${ENV_PATH}.`);
console.log('A local sign-in now commands as that account once the proxy restarts:');
console.log('  sudo systemctl restart ibems-proxy');
