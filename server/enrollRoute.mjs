/**
 * `POST /api/enroll` — the HTTP half of device enrolment.
 *
 * Thin on purpose. Every decision lives in `enrollService.mjs`, which the CLI also calls, so
 * the two cannot disagree about validation or about what happens when the second write fails.
 * This module's whole job is turning a request into that call and a result into a response.
 *
 * Returns the same shape whether it succeeded or not, because the wizard renders the problems
 * list either way — a caller that has to branch on shape before it can show an error tends to
 * show nothing.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createTuyaClient, TUYA_HOSTS } from './tuyaCloud.mjs';
import { createAdminClient, loadDotEnv } from '../node-red-bridge/nodeRedAdmin.mjs';
import { DEVICE_REGISTRY } from '../shared/registry.mjs';
import { enrollDevice } from './enrollService.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
loadDotEnv(join(HERE, '..'));
loadDotEnv(HERE);

const ENROLLED_PATH = join(HERE, '..', 'shared', 'registry.enrolled.mjs');

/** Where a generated node lands. Below the existing rows so it does not cover anything. */
function placementFor(flows) {
  const peer = flows.find((n) => n.type === 'tuya-smart-device' && /^CO\d$/.test(n.deviceName ?? ''));
  const lowest = Math.max(0, ...flows.filter((n) => typeof n.y === 'number').map((n) => n.y));
  return { z: peer?.z ?? flows.find((n) => n.type === 'tab')?.id, x: 200, y: lowest + 120 };
}

export async function handleEnroll(req, res, { readJsonBody, sendJson }) {
  const cloudHost = TUYA_HOSTS[(process.env.TUYA_REGION ?? '').toLowerCase()];
  if (!process.env.TUYA_ACCESS_ID || !process.env.TUYA_ACCESS_SECRET || !cloudHost) {
    return sendJson(res, 503, {
      ok: false,
      stage: 'unconfigured',
      problems: ['the vendor cloud is not configured on this deployment, so a local key cannot be fetched'],
      summary: null,
    });
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    return sendJson(res, 400, { ok: false, stage: 'request', problems: ['malformed request body'], summary: null });
  }

  const draft = {
    deviceId: body?.deviceId,
    class: body?.class,
    displayName: body?.displayName,
    room: body?.room,
    tuyaDeviceId: body?.tuyaDeviceId,
    branchCircuit: body?.branchCircuit,
  };
  // Applying is opt-in per request rather than a separate route, so the wizard's preview and
  // its confirm exercise exactly the same path and cannot diverge.
  const apply = body?.apply === true;

  let result;
  try {
    result = await enrollDevice(draft, {
      registry: DEVICE_REGISTRY,
      cloud: createTuyaClient({
        accessId: process.env.TUYA_ACCESS_ID,
        accessSecret: process.env.TUYA_ACCESS_SECRET,
        host: cloudHost,
      }),
      admin: createAdminClient({ host: '127.0.0.1', port: 1880, timeoutMs: 20000 }),
      readEnrolled: () => ({
        source: readFileSync(ENROLLED_PATH, 'utf8'),
        // Re-read rather than using the module's cached import: a previous enrolment in this
        // same process would otherwise be missing, and the second device would overwrite the
        // first instead of appending to it.
        devices: parseEnrolled(readFileSync(ENROLLED_PATH, 'utf8')),
      }),
      writeEnrolled: (source) => writeFileSync(ENROLLED_PATH, source),
      placementFor,
      apply,
    });
  } catch (err) {
    // An upstream that threw — cloud unreachable, Node-RED admin refusing a login. Reported as
    // a problem rather than a 500 so the wizard can render it beside its own validation.
    return sendJson(res, 502, {
      ok: false,
      stage: 'upstream',
      problems: [String(err?.message ?? err).slice(0, 200)],
      summary: null,
    });
  }

  return sendJson(res, result.ok ? 200 : 422, result);
}

/** The array literal out of the generated module, without importing it. Shared with
 * `removeRoute.mjs`, so both halves read the generated file the same way. */
export function parseEnrolled(source) {
  const m = /export const ENROLLED_DEVICES = (\[[\s\S]*\]);/.exec(source);
  if (!m) return [];
  try {
    return JSON.parse(m[1]);
  } catch {
    return [];
  }
}
