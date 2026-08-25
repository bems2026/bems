/**
 * `POST /api/remove` — the HTTP half of device removal.
 *
 * Thin on purpose, exactly like `enrollRoute.mjs`: every decision lives in `removeService.mjs`,
 * which the CLI also calls, so the two cannot disagree. Returns the same shape whether it
 * succeeded or not, because the UI renders the problems list either way.
 *
 * NO CLOUD DEPENDENCY. Enrolment needs the vendor cloud for a local key; removal needs nothing
 * but the flow and the registry, so it stays available on a deployment with no Tuya
 * credentials — which is also the deployment most likely to need to undo something.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createAdminClient } from '../node-red-bridge/nodeRedAdmin.mjs';
import { DEVICE_REGISTRY } from '../shared/registry.mjs';
import { removeDevice } from './removeService.mjs';
import { parseEnrolled } from './enrollRoute.mjs';

// Environment is NOT loaded here, deliberately. This module is imported by `proxy.mjs`, and a
// top-level `loadDotEnv` made that import load every secret in `server/.env` into the process —
// including TUYA_ACCESS_SECRET, and including in tests that had set up a deployment with no
// credentials at all. Entrypoints own the environment: the systemd unit supplies it via
// EnvironmentFile, and the CLIs load it themselves. See server/envHygiene.test.mjs.

const HERE = dirname(fileURLToPath(import.meta.url));

const ENROLLED_PATH = join(HERE, '..', 'shared', 'registry.enrolled.mjs');

export async function handleRemove(req, res, { readJsonBody, sendJson }) {
  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    return sendJson(res, 400, { ok: false, stage: 'request', problems: ['malformed request body'], summary: null });
  }

  // Applying is opt-in per request rather than a separate route, so the preview and the
  // confirm exercise exactly the same path and cannot diverge.
  const apply = body?.apply === true;

  let result;
  try {
    result = await removeDevice({ deviceId: body?.deviceId }, {
      registry: DEVICE_REGISTRY,
      admin: createAdminClient({ host: '127.0.0.1', port: 1880, timeoutMs: 20000 }),
      readEnrolled: () => {
        // Read fresh rather than using the module's cached import: a removal earlier in this
        // same process would otherwise be missing, and this one would resurrect it.
        const source = readFileSync(ENROLLED_PATH, 'utf8');
        return { source, devices: parseEnrolled(source) };
      },
      writeEnrolled: (source) => writeFileSync(ENROLLED_PATH, source),
      apply,
    });
  } catch (err) {
    return sendJson(res, 502, {
      ok: false,
      stage: 'upstream',
      problems: [String(err?.message ?? err).slice(0, 200)],
      summary: null,
    });
  }

  return sendJson(res, result.ok ? 200 : 422, result);
}
