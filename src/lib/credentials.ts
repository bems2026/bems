import { fetchJson } from './bridgeClient';

/**
 * The client half of `POST /api/credentials/import` (2026-09-17).
 *
 * The export text a key tool produced goes to the proxy, which stores the keys on the Pi and answers
 * with counts and per-row problems — never a key. The browser holds the text only between the paste
 * and this call; the panel clears it once the proxy has it.
 */

export interface ImportResult {
  ok: boolean;
  format: 'json' | 'csv' | null;
  added: number;
  updated: number;
  total: number;
  /** The operator said the export lists every device in the account. */
  complete: boolean;
  /** Rows reported and skipped — by name or id, never by key. */
  problems: string[];
}

/** Resolves rather than throws, as `lib/enroll.ts` does: a refusal is a result to render. */
export async function importCredentials(content: string, complete: boolean): Promise<ImportResult> {
  try {
    return await fetchJson<ImportResult>('/credentials/import', { method: 'POST', body: { content, complete } });
  } catch (err) {
    // fetchJson reports a non-2xx as "HTTP 422: <reason>"; the reason is what the operator needs.
    const message = (err instanceof Error ? err.message : String(err)).replace(/^HTTP \d+:\s*/, '');
    return { ok: false, format: null, added: 0, updated: 0, total: 0, complete: false, problems: [message] };
  }
}
