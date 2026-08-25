import { fetchJson } from './bridgeClient';

/**
 * The client half of `POST /api/remove` — the mirror of `enroll.ts`.
 *
 * Resolves rather than throws for a refusal, for the same reason: a 422 here is the server
 * saying "no, and here is why", and the UI's job is to render those reasons. Genuine transport
 * failures surface as `stage: 'upstream'` so the caller has exactly one shape to handle.
 */

export interface RemoveSummary {
  deviceId: string;
  displayName: string;
  deviceClass: string | null;
  /** The flow nodes that would disappear, by name — more useful to read than a count. */
  removedNodes: string[];
  nodesBefore: number;
  nodesAfter: number;
}

export interface RemoveResult {
  ok: boolean;
  stage: 'validate' | 'plan' | 'invariants' | 'flow' | 'registry' | 'dry-run' | 'applied' | 'request' | 'upstream';
  problems: string[];
  summary: RemoveSummary | null;
}

export async function removeDevice(deviceId: string, apply: boolean): Promise<RemoveResult> {
  try {
    // A path, not a URL — `fetchJson` owns the base address. See bridgeClientPaths.test.ts.
    return await fetchJson<RemoveResult>('/remove', { method: 'POST', body: { deviceId, apply } });
  } catch (err) {
    return {
      ok: false,
      stage: 'upstream',
      problems: [err instanceof Error ? err.message : String(err)],
      summary: null,
    };
  }
}
