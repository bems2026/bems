/**
 * Mirrors the TIMING constants in `shared/registry.mjs` (which the bridge and mock both
 * use). Duplicated rather than imported so the frontend build never reaches outside
 * `src/` for runtime code — but the duplication is guarded by `timing.test.ts`, which
 * fails loudly the moment the two drift apart. Same pattern as the mock/bridge drift
 * guards in `test/contract.test.mjs`.
 */
export const TIMING = {
  WS_PUSH_MS: 2000,
  HISTORY_SAMPLE_MS: 60000,
  HISTORY_MAX_POINTS: 1440,
  POLL_FALLBACK_MS: 15000,
  STALE_AFTER_MS: 30000,
  FETCH_TIMEOUT_MS: 10000,
  BACKOFF_CAP_MS: 120000,
  COMMAND_TIMEOUT_MS: 5000,
  COMMAND_CONFIRM_MS: 6000,
} as const;
