/**
 * Tests for server/hotTier.mjs — one retention pass of RM-148's hot tier, end to end: seal and copy
 * off the edge, then prune the cloud only where the edge holds it.
 *
 * A real archive, a hand-rolled cloud (rows in an array; oldest-row read, manifest and rollup RPCs),
 * and a hand-rolled file storage.
 *
 *     node --test server/hotTier.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { openArchive, ORIGIN } from './archiveDb.mjs';
import { runHotTierPass } from './hotTier.mjs';
import { RAW_RETENTION_DAYS } from '../shared/retention.mjs';

const DAY = 86_400_000;
const HOUR = 3_600_000;
const D0 = Date.parse('2026-09-01T00:00:00Z');
const NOW = D0 + 20 * DAY + 2 * HOUR;

function temp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ibems-hottier-test-'));
  const archive = openArchive(path.join(dir, 'archive.sqlite'));
  t.after(() => { archive.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  return { archive, sealedDir: path.join(dir, 'sealed') };
}

const reading = (ms) => ({
  device_id: 'co1', ts: new Date(ms).toISOString(), voltage: 230, current: 0.1, power_w: 10, energy_kwh_today: 0.1,
  online: true, total_energy_kwh: null, warn_power_w: null, power_type: null, net_state: null, fault: null, capabilities: null,
});
const totals = (ms) => ({
  ts: new Date(ms).toISOString(), site_id: 's', energy_kwh_today: 1, energy_kwh_week: null, energy_kwh_month: null,
  energy_kwh_today_integrated: null, energy_kwh_week_integrated: null, energy_kwh_month_integrated: null,
  total_power_w: 10, avg_voltage: 230, phase_current_red: null, phase_current_yellow: null, phase_current_blue: null,
});

function cloud(tables) {
  const prunes = [];
  const client = {
    async select(table, query) {
      if (!query.startsWith('select=ts&order=ts.asc&limit=1')) throw new Error(`unexpected select ${query}`);
      const oldest = tables[table].map((r) => Date.parse(r.ts)).sort((a, b) => a - b)[0];
      return oldest === undefined ? [] : [{ ts: new Date(oldest).toISOString() }];
    },
    async rpc(fn, args) {
      const stream = fn.includes('building_totals') ? 'building_totals' : 'readings';
      const rows = tables[stream];
      const within = (r) => Date.parse(r.ts) >= Date.parse(args.p_since) && Date.parse(r.ts) < Date.parse(args.p_until);
      if (fn.endsWith('_manifest')) {
        const counts = new Map();
        for (const r of rows.filter(within)) {
          const key = `${r.device_id ?? ''}|${Math.floor(Date.parse(r.ts) / HOUR) * HOUR}`;
          counts.set(key, (counts.get(key) ?? 0) + 1);
        }
        return [...counts].map(([k, n]) => ({ ...(stream === 'readings' ? { device_id: k.split('|')[0] } : {}), hour: new Date(Number(k.split('|')[1])).toISOString(), n }));
      }
      prunes.push(`${stream} < ${args.p_before}`);
      const before = rows.length;
      for (let i = rows.length - 1; i >= 0; i--) if (Date.parse(rows[i].ts) < Date.parse(args.p_before)) rows.splice(i, 1);
      return [{ rolled: 1, deleted: before - rows.length }];
    },
  };
  return { client, prunes };
}

const storage = (objects = new Map()) => ({ objects, upload: async (b, p, bytes) => { objects.set(`${b}/${p}`, bytes); } });

test('the cloud keeps 14 days of raw rows', () => {
  assert.equal(RAW_RETENTION_DAYS, 14);
});

test('one pass seals the old days, copies them off the edge, and then prunes both raw tables', async (t) => {
  const { archive, sealedDir } = temp(t);
  const old = [reading(D0 + 5 * DAY), reading(D0 + 5 * DAY + HOUR)];
  const oldTotals = [totals(D0 + 5 * DAY)];
  archive.insertRows('readings', old, { origin: ORIGIN.cloud });
  archive.insertRows('building_totals', oldTotals, { origin: ORIGIN.cloud });
  const recent = reading(NOW - HOUR);
  const tables = { readings: [...old.map((r) => ({ ...r })), recent], building_totals: oldTotals.map((r) => ({ ...r })) };
  const { client, prunes } = cloud(tables);
  const store = storage();

  const result = await runHotTierPass({ client, archive, storage: store, bucket: 'b', siteId: 's', sealedDir, hotDays: 14, nowMs: NOW });

  assert.deepEqual(result.seal.sealed.sort(), ['2026-09-06 building_totals', '2026-09-06 readings']);
  assert.equal(store.objects.size, 2);
  assert.deepEqual(prunes, ['readings < 2026-09-07T00:00:00.000Z', 'building_totals < 2026-09-07T00:00:00.000Z']);
  assert.deepEqual(tables.readings, [recent], 'the recent row stays in the cloud');
  assert.equal(result.readings.blocked, null);
  assert.equal(result.building_totals.deleted, 1);
});

test('with the copy off the edge failing, the day is sealed but nothing is pruned', async (t) => {
  const { archive, sealedDir } = temp(t);
  const old = [reading(D0 + 5 * DAY)];
  archive.insertRows('readings', old, { origin: ORIGIN.cloud });
  const tables = { readings: old.map((r) => ({ ...r })), building_totals: [] };
  const { client, prunes } = cloud(tables);
  const down = { upload: async () => { throw Object.assign(new Error('Storage POST -> 503: down'), { status: 503 }); } };

  const result = await runHotTierPass({ client, archive, storage: down, bucket: 'b', siteId: 's', sealedDir, hotDays: 14, nowMs: NOW });

  assert.deepEqual(prunes, []);
  assert.match(result.seal.errors.join(' '), /503/);
  assert.match(result.readings.blocked, /not yet copied off the edge/);
  assert.equal(tables.readings.length, 1);
});

test('the daemon runs the hot tier only with an archive, and the pause flag stops uploads, retention and reports but not archiving', async () => {
  // Read from source: ingest.mjs exits on missing configuration, so it cannot be imported by a test.
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('./ingest.mjs', import.meta.url), 'utf8');
  const fn = (name) => src.slice(src.indexOf(`async function ${name}(`), src.indexOf('\n}\n', src.indexOf(`async function ${name}(`)));
  const retention = fn('retentionPass');
  assert.match(retention, /if \(paused\(\)\) \{[\s\S]*?return;/, 'retention must stop while paused');
  // Stage 4 is switched on by the operator, not by a restart: without ARCHIVE_HOT_TIER=1 the raw
  // tables keep the 30-day window they had, archive or not.
  assert.match(src, /const HOT_TIER = process\.env\.ARCHIVE_HOT_TIER === '1';/);
  assert.match(retention, /const hot = Boolean\(archive\) && HOT_TIER;/);
  assert.match(retention, /if \(hot\) await hotTierPass\(\);/);
  assert.match(retention, /hot \? RETENTION_PASSES\.filter\(\(p\) => !p\.usesConfiguredWindow\) : RETENTION_PASSES/,
    'with the hot tier on, the 30-day raw passes must not also run');
  assert.match(fn('reportPass'), /if \(paused\(\)\) \{[\s\S]*?return true;/, 'reports must stop while paused');
  const tick = fn('tick');
  assert.match(tick, /archive: \(batch\) => \{[^}]*return archive\.insertTick\(batch\);\s*\}/, 'archiving continues while paused');
  assert.match(tick, /sync: async \(\) => \{\s*if \(paused\(\)\) return \{ ok: false/, 'uploads stop while paused, before anything else is decided');
  // Seen on the edge 2026-09-30: a paused tick logged "Supabase unreachable", which sends whoever
  // reads the journal looking for an outage that is not there.
  assert.match(tick, /\} else if \(result\.archived && paused\(\)\) \{\s*console\.log\(`\[ibems-ingest\] \$\{stamp\} cloud upload paused by the operator/);
  assert.match(src, /hotDays: HOT_DAYS/);
  assert.match(src, /const HOT_DAYS = Number\(process\.env\.INGEST_RETENTION_DAYS\) \|\| RAW_RETENTION_DAYS;/);
});

test('one table failing does not stop the other', async (t) => {
  const { archive, sealedDir } = temp(t);
  const oldTotals = [totals(D0 + 5 * DAY)];
  archive.insertRows('building_totals', oldTotals, { origin: ORIGIN.cloud });
  const tables = { readings: [], building_totals: oldTotals.map((r) => ({ ...r })) };
  const { client } = cloud(tables);
  const broken = { ...client, select: async (table, q) => { if (table === 'readings') throw new Error('readings exploded'); return client.select(table, q); } };
  const result = await runHotTierPass({ client: broken, archive, storage: storage(), bucket: 'b', siteId: 's', sealedDir, hotDays: 14, nowMs: NOW });
  assert.match(result.readings.error, /readings exploded/);
  assert.equal(result.building_totals.deleted, 1);
});
