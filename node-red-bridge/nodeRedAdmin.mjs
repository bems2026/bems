/**
 * Shared Node-RED Admin API helpers — extracted from `deploy.mjs` so it and
 * `fix-tuya-health-signals.mjs` (and any future script that writes to a live flow) use one
 * single-source implementation of login/fetch/GET-then-POST-with-rev, rather than two
 * copies that could quietly drift from each other. Both scripts remain the only things in
 * this repo allowed to mutate a live system; this module is the machinery they share, not
 * a general-purpose Node-RED client.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Minimal `.env` loader — no dependency, matching the rest of this Node-side tooling.
 * Only `KEY=value` lines, `#` comments, and blank lines; no quoting/escaping/multiline
 * support. Real environment variables always win over the file (standard dotenv
 * precedence) — an operator exporting the var in their own shell should never be silently
 * overridden by a stale `.env`. `repoRoot` is the directory containing `.env` — callers
 * pass their own `dirname(fileURLToPath(import.meta.url))/..`.
 */
export function loadDotEnv(repoRoot) {
  const path = join(repoRoot, '.env');
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    if (process.env[key] !== undefined) continue;
    process.env[key] = trimmed.slice(eq + 1).trim();
  }
}

/**
 * Builds a small client bound to one Node-RED instance. Every method throws a message
 * meant to be printed directly and exited on (`process.exit(1)`) by the caller — these
 * scripts are short-lived CLI tools, not a library meant to be embedded elsewhere.
 */
export function createAdminClient({ host, port, timeoutMs = 8000 }) {
  const BASE = `http://${host}:${port}`;

  async function fetchWithTimeout(path, opts = {}) {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(`${BASE}${path}`, { ...opts, signal: controller.signal });
    } finally {
      clearTimeout(t);
    }
  }

  /**
   * Logs into Node-RED's Admin API the same way its own editor login page does — the
   * Resource Owner Password Credentials grant `adminAuth` implements at `/auth/token`
   * (`client_id=node-red-admin`, per Node-RED's own auth docs).
   *
   * Returns `null` — not a thrown error — when no credentials are configured, so the
   * caller can fall through to unauthenticated behaviour for instances that never had
   * adminAuth turned on. A configured-but-wrong credential pair DOES throw.
   */
  async function login() {
    const username = process.env.NODE_RED_ADMIN_USER;
    const password = process.env.NODE_RED_ADMIN_PASS;
    if (!username || !password) return null;

    const res = await fetchWithTimeout('/auth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: 'node-red-admin', grant_type: 'password', scope: '*', username, password }),
    });
    if (!res.ok) {
      throw new Error(
        `Node-RED admin login failed (HTTP ${res.status}) for user "${username}" — check NODE_RED_ADMIN_USER/NODE_RED_ADMIN_PASS. ` +
          (res.status === 401 ? 'Wrong username or password.' : `Unexpected response: ${await res.text().catch(() => '')}`),
      );
    }
    const { access_token: token, token_type: tokenType } = await res.json();
    if (!token) throw new Error('Node-RED admin login succeeded but returned no access_token — unexpected response shape.');
    return `${tokenType ?? 'Bearer'} ${token}`;
  }

  /**
   * GETs the full live flow set plus its `rev` — the revision token that must be sent
   * back on the POST so a concurrent editor change causes a 409 conflict instead of being
   * silently overwritten. `Node-RED-API-Version: v2` is not optional: without it, older
   * Node-RED defaults return the legacy v1 shape (a bare array, no `rev`), which breaks
   * this destructure and loses conflict detection entirely.
   */
  async function getFlows(authHeader) {
    const res = await fetchWithTimeout('/flows', {
      headers: { Accept: 'application/json', 'Node-RED-API-Version': 'v2', ...(authHeader ? { Authorization: authHeader } : {}) },
    });
    if (!res.ok) {
      if (res.status === 401 && !authHeader) {
        throw new Error(
          'GET /flows returned HTTP 401 — this instance has adminAuth enabled. Set NODE_RED_ADMIN_USER and ' +
            'NODE_RED_ADMIN_PASS (in .env or the environment) to the same login you\'d use for the Node-RED editor, then re-run.',
        );
      }
      throw new Error(`GET /flows returned HTTP ${res.status} — is the Admin API reachable at ${BASE}?`);
    }
    return res.json(); // { flows, rev }
  }

  /** POSTs a full flow set with `Node-RED-Deployment-Type: nodes` — restarts only the
   * nodes that changed, never the whole runtime. */
  async function postFlows(authHeader, flows, rev) {
    return fetchWithTimeout('/flows', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Node-RED-API-Version': 'v2',
        'Node-RED-Deployment-Type': 'nodes',
        ...(authHeader ? { Authorization: authHeader } : {}),
      },
      body: JSON.stringify({ flows, rev }),
    });
  }

  return { BASE, fetchWithTimeout, login, getFlows, postFlows };
}
