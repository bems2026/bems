import { fetchJson } from './bridgeClient';

/**
 * The client half of `POST /api/rebind` — pointing a flow node whose device was re-paired in Smart
 * Life at the device that replaced it. Same shape and reasoning as `lib/enroll.ts`: the browser sends
 * a choice, the proxy fetches the new local key and writes the flow, and the key never comes here.
 */

export interface RebindSummary {
  nodeName: string;
  vendorName: string | null;
  vendorOnline: boolean | null;
  kind: string;
  /** As the device announces it on the LAN. */
  tuyaVersion: string;
  declaredVersion: string | null;
  versionMatchesDeclaration: boolean | null;
  /** Length only. */
  localKeyLength: number;
  fieldsChanged: string[];
  notes: string[];
}

export interface RebindResult {
  ok: boolean;
  stage: 'validate' | 'credentials' | 'plan' | 'invariants' | 'flow' | 'dry-run' | 'applied' | 'request' | 'upstream' | 'unconfigured';
  problems: string[];
  summary: RebindSummary | null;
}

export interface RebindRequest {
  nodeName: string;
  tuyaDeviceId: string;
  /** `false` previews, `true` writes — one endpoint, so the preview is exactly the write. */
  apply: boolean;
}

/** Resolves rather than throws for a refusal; a transport failure comes back as `stage: 'upstream'`. */
export async function rebindDevice(body: RebindRequest): Promise<RebindResult> {
  try {
    return await fetchJson<RebindResult>('/rebind', { method: 'POST', body });
  } catch (err) {
    return { ok: false, stage: 'upstream', problems: [err instanceof Error ? err.message : String(err)], summary: null };
  }
}
