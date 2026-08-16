/**
 * The only place a Supabase URL/key appears in the frontend — same rule
 * `src/config/bridge.ts` follows for the bridge address. Everything else imports
 * `supabase` from here.
 *
 * `VITE_SUPABASE_ANON_KEY` is the **anon/public** key, not the service-role key —
 * it's safe to ship in the browser bundle precisely because it's RLS-constrained.
 * `server/ingest.mjs`'s service-role key must never appear here or anywhere under `src/`.
 *
 * Phase 4: `readings`/`devices`/`building_totals` temporarily allow anon `select`
 * (`supabase/phase4_anon_read.sql`) so history can ship before auth exists. Phase 5 locks
 * that down to `authenticated` only, once a login screen exists to authenticate against —
 * see the architecture plan's Phase 5.
 */

import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

/** `null` when unconfigured (e.g. local dev against the mock bridge with no Supabase
 * project set up) — callers must check for this and degrade gracefully, never assume
 * Supabase-backed history is available. */
export const supabase = url && anonKey ? createClient(url, anonKey) : null;
