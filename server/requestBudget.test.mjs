/**
 * RM-149 — the hosted database's request budget, pinned where the daemons spend it.
 *
 * Every request to the hosted database is a line in its log, and on 2026-09-30 the Free plan's log
 * ingestion stood at 0.97 of 1 GB — the one quota still near its limit after RM-148. Read from source,
 * as server/testStatePaths.test.mjs does, because `ingest.mjs` exits on missing configuration and
 * cannot be imported by a test; the decisions themselves are unit-tested beside their modules
 * (`uploadDue`, `uploadIntervalFrom`, `createHealthCadence`).
 *
 *     node --test server/requestBudget.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ingest = readFileSync(new URL('./ingest.mjs', import.meta.url), 'utf8');
const fn = (src, name) => src.slice(src.indexOf(`async function ${name}(`), src.indexOf('\n}\n', src.indexOf(`async function ${name}(`)));

test('ingest uploads the archive on an interval, and at once for an anomaly', () => {
  const tick = fn(ingest, 'tick');
  assert.match(tick, /uploadDue\(\{ nowMs: Date\.now\(\), lastUploadMs, intervalMs: UPLOAD_EVERY_MS, hasAnomalies: tickHadAnomalies \}\)/);
  assert.match(tick, /return \{ ok: true, error: null, deferred: true \};/, 'a waiting tick is healthy, not a failure');
  assert.match(tick, /tickHadAnomalies = batch\.anomalies\.length > 0;/);
  assert.match(ingest, /const UPLOAD_EVERY_MS = uploadIntervalFrom\(process\.env\.INGEST_UPLOAD_MS\);/);
});

test('the health row goes up with the uploads and on any change of health, carrying refused fields, and every tick only without an archive', () => {
  const health = fn(ingest, 'updateHealth');
  assert.match(health, /healthCadence\.due\(rejections, \{ force: uploadedThisTick \|\| !archive, ok \}\)/);
  assert.match(health, /if \(toWrite === null\) return;/);
  assert.match(health, /rejections: toWrite,/);
});

test('the device list is sent only when it has changed', () => {
  const sync = fn(ingest, 'syncDevices');
  assert.match(sync, /if \(snapshot === lastDevicesSnapshot\) return;/);
  assert.ok(sync.indexOf('lastDevicesSnapshot = snapshot') > sync.indexOf("supabase.upsert('devices'"), 'remembered only after the cloud took it');
});
