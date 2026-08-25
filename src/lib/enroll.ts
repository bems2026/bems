import { fetchJson } from './bridgeClient';

/**
 * The client half of `POST /api/enroll`.
 *
 * The credential never comes near here. Fetching a device's local key needs
 * `TUYA_ACCESS_SECRET`, which lives only in `server/.env` — so the browser sends a choice and
 * the proxy does the work. This module carries the choice and renders back what happened.
 */

export interface EnrollSummary {
  deviceId: string;
  displayName: string;
  deviceClass: string;
  ctx: string | null;
  dpsMap: string | null;
  vendorName: string | null;
  vendorOnline: boolean | null;
  tuyaVersion: string;
  /** Length only — the server never sends the key itself, and nothing here should want it. */
  localKeyLength: number;
  nodesBefore: number;
  nodesAfter: number;
}

export interface EnrollResult {
  ok: boolean;
  /** Which step refused, or `dry-run` / `applied` on success. Rendered, so it must stay readable. */
  stage: 'validate' | 'credentials' | 'plan' | 'invariants' | 'registry' | 'flow' | 'dry-run' | 'applied' | 'request' | 'upstream' | 'unconfigured';
  problems: string[];
  summary: EnrollSummary | null;
}

export interface EnrollRequest {
  deviceId: string;
  class: string;
  displayName: string;
  room?: string;
  tuyaDeviceId: string;
  branchCircuit?: string;
  /** `false` previews, `true` writes. Same endpoint either way, so the two cannot drift. */
  apply: boolean;
}

/**
 * Resolves rather than throws for a refusal. A 422 here is the server saying "no, and here is
 * why" — the wizard's job is to render those reasons, not to treat them as a failure of the
 * request itself. Genuine transport failures still surface as a result with `stage: 'upstream'`
 * so the caller has exactly one shape to handle.
 */
export async function enrollDevice(body: EnrollRequest): Promise<EnrollResult> {
  try {
    // A path, not a URL, and an object body — `fetchJson` owns the base address and the
    // serialisation. Building either here would duplicate the one place a bridge URL is
    // allowed to appear (src/config/bridge.ts).
    return await fetchJson<EnrollResult>('/api/enroll', { method: 'POST', body });
  } catch (err) {
    return {
      ok: false,
      stage: 'upstream',
      problems: [err instanceof Error ? err.message : String(err)],
      summary: null,
    };
  }
}
