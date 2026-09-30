#!/usr/bin/env node
/**
 * Arms the database's watchdog over this edge — RM-150 (F-034). Needs supabase/phase51 applied.
 *
 *     npm run watchdog:setup              dry run: what it would write, and the watchdog's state
 *     npm run watchdog:setup -- --apply   write this site's row, then send one test notice through
 *                                         the database, and report whether the server took it
 *
 * The topic comes from server/.env (NTFY_TOPIC, NTFY_SERVER) and is never printed whole.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadDotEnv } from '../node-red-bridge/nodeRedAdmin.mjs';
import { watchdogRowFrom, maskTopic } from './edgeWatchdog.mjs';
import { SITE } from '../shared/registry.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
loadDotEnv(path.join(HERE, '..'));
loadDotEnv(HERE);

const APPLY = process.argv.includes('--apply');
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required in server/.env');
  process.exit(2);
}
const base = `${url.replace(/\/+$/, '')}/rest/v1`;
const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
const rest = async (p, init = {}) => {
  const res = await fetch(`${base}/${p}`, { ...init, headers: { ...headers, ...(init.headers ?? {}) }, signal: AbortSignal.timeout(15_000) });
  const text = await res.text();
  if (!res.ok) throw Object.assign(new Error(`${p.split('?')[0]} -> ${res.status}: ${text.slice(0, 200)}`), { status: res.status });
  return text ? JSON.parse(text) : null;
};

const { row, error } = watchdogRowFrom(process.env, SITE.id);
if (error) {
  console.error(error);
  process.exit(2);
}

let current;
try {
  current = (await rest(`edge_watchdog?select=site_id,ntfy_server,state,stale_after,remind_every,alerted_at,checked_at&site_id=eq.${encodeURIComponent(SITE.id)}`))[0] ?? null;
} catch (err) {
  if (err.status === 404) {
    console.error('edge_watchdog does not exist: apply supabase/phase51_edge_watchdog.sql in the SQL editor first.');
    process.exit(2);
  }
  throw err;
}

console.log(`site ${SITE.id}: notices to ${row.ntfy_server}, topic ${maskTopic(row.ntfy_topic)}`);
console.log(current
  ? `watchdog row present: state ${current.state}, silent after ${current.stale_after}, reminds every ${current.remind_every}, last checked ${current.checked_at ?? 'never'}`
  : 'no watchdog row yet: the database checks nothing for this site');

if (!APPLY) {
  console.log('\nDry run. Add --apply to write the row and send one test notice through the database.');
  process.exit(0);
}

await rest('edge_watchdog?on_conflict=site_id', {
  method: 'POST',
  headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
  body: JSON.stringify({ ...row, updated_at: new Date().toISOString() }),
});
console.log('row written');

const requestId = await rest('rpc/edge_watchdog_ping', { method: 'POST', body: JSON.stringify({ p_site_id: SITE.id }) });
let answer = null;
for (let i = 0; i < 10 && !answer; i++) {
  await new Promise((r) => setTimeout(r, 1500));
  answer = await rest('rpc/edge_watchdog_ping_result', { method: 'POST', body: JSON.stringify({ p_request_id: requestId }) });
}
if (!answer) {
  console.error(`test notice ${requestId}: no answer recorded yet. Check the phone, and net._http_response in the SQL editor.`);
  process.exitCode = 1;
} else if (answer.status_code >= 200 && answer.status_code < 300) {
  console.log(`test notice ${requestId}: the server took it (HTTP ${answer.status_code}). It should be on the phone now.`);
} else {
  console.error(`test notice ${requestId}: refused (HTTP ${answer.status_code ?? '—'}${answer.error ? `, ${answer.error}` : ''})`);
  process.exitCode = 1;
}
