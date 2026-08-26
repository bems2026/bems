#!/usr/bin/env node
/**
 * Returns the Pi to its preferred Wi-Fi network when that network comes back, and puts it
 * straight back if the move does not work.
 *
 *     node server/wifi-prefer.mjs [--dry-run] [--verbose]
 *
 * Run from a systemd timer. The decision lives in `wifiPreference.mjs` and is unit-tested;
 * this file is the I/O around it — read nmcli, act, verify, revert.
 *
 * THE SAFETY CONTRACT, which matters more than the feature:
 *   - it only ever moves TOWARDS the highest-priority saved profile, never away from it;
 *   - it will not leave a working connection for one that is out of range or weak;
 *   - a move counts as successful only if the Pi ends up associated to the target AND can
 *     reach the internet. Anything less is reverted to whatever it was on before;
 *   - if the revert also fails, it tries every other saved profile before giving up, because
 *     the operator is usually remote and a Pi with no uplink cannot be recovered from here;
 *   - a failed attempt starts a backoff, so a half-broken AP cannot cause endless churn.
 *
 * `touch /home/bems/.ibems-wifi-prefer.disabled` stops it entirely — for when someone deliberately
 * wants the Pi parked on another network.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { decideWifiMove, ACTION } from './wifiPreference.mjs';

const DRY = process.argv.includes('--dry-run');
const VERBOSE = process.argv.includes('--verbose');
// Fixed paths, not $HOME: the timer runs this as root while a human debugging it runs it as
// `bems`, and a disable flag that only works for whichever account created it is a trap.
const DISABLE_FLAG = '/home/bems/.ibems-wifi-prefer.disabled';
const STATE_PATH = '/home/bems/.ibems-wifi-prefer.state';
const CONNECT_CHECK = 'https://api.ipify.org';

const log = (...a) => console.log(`[wifi-prefer] ${a.join(' ')}`);
const sh = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8', timeout: 60_000 });

function readState() {
  try { return JSON.parse(readFileSync(STATE_PATH, 'utf8')); } catch { return {}; }
}
function writeState(next) {
  try { writeFileSync(STATE_PATH, JSON.stringify(next, null, 2)); } catch (e) { log('could not write state:', e.message); }
}

/** Saved Wi-Fi profiles with their SSIDs. NAME and SSID are not reliably the same thing. */
function savedWifiProfiles() {
  const rows = sh('nmcli', ['-t', '-f', 'NAME,TYPE,AUTOCONNECT,AUTOCONNECT-PRIORITY', 'connection', 'show'])
    .split('\n').filter(Boolean)
    .map((l) => l.split(':'))
    .filter(([, type]) => type === '802-11-wireless');
  return rows.map(([name, , autoconnect, priority]) => {
    let ssid = name;
    try {
      const out = sh('nmcli', ['-t', '-f', '802-11-wireless.ssid', 'connection', 'show', name]).trim();
      const v = out.split(':').slice(1).join(':').trim();
      if (v) ssid = v;
    } catch { /* fall back to the profile name */ }
    return { name, ssid, autoconnect: autoconnect === 'yes', priority: Number(priority) || 0 };
  });
}

function visibleNetworks() {
  const out = sh('nmcli', ['-t', '-f', 'SSID,SIGNAL', 'device', 'wifi', 'list', '--rescan', 'yes']);
  const best = {};
  for (const line of out.split('\n').filter(Boolean)) {
    const idx = line.lastIndexOf(':');
    const ssid = line.slice(0, idx);
    const signal = Number(line.slice(idx + 1));
    if (!ssid) continue;
    if (best[ssid] === undefined || signal > best[ssid]) best[ssid] = signal;
  }
  return best;
}

const currentSsid = () => { try { return sh('iwgetid', ['-r']).trim() || null; } catch { return null; } };
const currentProfile = () => {
  try {
    return sh('nmcli', ['-t', '-f', 'NAME,TYPE', 'connection', 'show', '--active'])
      .split('\n').map((l) => l.split(':')).find(([, t]) => t === '802-11-wireless')?.[0] ?? null;
  } catch { return null; }
};

function internetReachable() {
  try { sh('curl', ['-sf', '--max-time', '8', '-o', '/dev/null', CONNECT_CHECK]); return true; }
  catch { return false; }
}

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/** Associated to `ssid` AND able to reach the internet. Both, or it is not a success. */
function settled(ssid, tries = 12, gapMs = 5000) {
  for (let i = 0; i < tries; i++) {
    if (currentSsid() === ssid && internetReachable()) return true;
    sleep(gapMs);
  }
  return false;
}

function bringUp(profileName) {
  try { sh('nmcli', ['--wait', '40', 'connection', 'up', profileName]); return true; }
  catch (e) { log(`nmcli up "${profileName}" failed:`, String(e.message).split('\n')[0]); return false; }
}

// ---------------------------------------------------------------------------

if (existsSync(DISABLE_FLAG)) {
  log(`disabled by ${DISABLE_FLAG} — doing nothing`);
  process.exit(0);
}

const state = readState();
const saved = savedWifiProfiles();
const visible = visibleNetworks();
const nowSsid = currentSsid();

if (VERBOSE) {
  log('saved  :', saved.map((p) => `${p.ssid}(p${p.priority}${p.autoconnect ? '' : ',off'})`).join(' '));
  log('visible:', Object.entries(visible).map(([s, v]) => `${s}=${v}`).join(' '));
  log('current:', nowSsid ?? '(none)');
}

const decision = decideWifiMove({
  savedWifi: saved, visible, currentSsid: nowSsid,
  now: Date.now(), lastFailureAt: state.lastFailureAt ?? null,
});

if (decision.action === ACTION.NONE) {
  log('no action:', decision.reason);
  process.exit(0);
}

log(`would switch: ${decision.reason}`);
if (DRY) { log('--dry-run: stopping before touching the radio'); process.exit(0); }

const previousProfile = currentProfile();
log(`switching to "${decision.target.name}" (was "${previousProfile ?? 'none'}")`);

bringUp(decision.target.name);

if (settled(decision.target.ssid)) {
  log(`SUCCESS: on ${currentSsid()}, internet reachable`);
  writeState({ ...state, lastFailureAt: null, lastSuccessAt: Date.now() });
  process.exit(0);
}

log(`FAILED to settle on ${decision.target.ssid} — reverting to "${previousProfile ?? 'unknown'}"`);
writeState({ ...state, lastFailureAt: Date.now() });

if (previousProfile && bringUp(previousProfile) && settled(currentSsid() ?? '', 6, 5000) && internetReachable()) {
  log(`reverted: on ${currentSsid()}, internet reachable`);
  process.exit(0);
}

// Last resort. Being remote with no uplink is the one outcome worth thrashing to avoid.
log('revert did not restore the internet — trying every other saved profile');
for (const p of saved.filter((p) => p.name !== decision.target.name && p.name !== previousProfile)) {
  log(`trying "${p.name}"`);
  if (bringUp(p.name) && internetReachable()) { log(`recovered on ${currentSsid()}`); process.exit(0); }
}
log('NO uplink after trying every saved profile — needs someone on site');
process.exit(1);
