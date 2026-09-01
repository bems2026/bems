/**
 * `site_ui_prefs` reads and writes — RM-035. Straight from the browser, RLS-gated to
 * `authenticated`, the same pattern as `supabaseSpaceTree.ts` and `supabaseDeviceConfig.ts`.
 *
 * The shape lives in `siteUi.ts` and is pure; this file is the network calls.
 */

import { supabase } from '@/config/supabase';
import { SITE } from '@shared/siteConfig.mjs';
import { readSiteUi, writeSiteUi, SITE_UI_DEFAULTS, type SiteUiPrefs } from './siteUi';

/** What the row holds, and what was already in it. The raw blob rides along so a save can merge
 * over keys this build does not know about — see `writeSiteUi`. */
export interface SiteUiRow {
  prefs: SiteUiPrefs;
  raw: unknown;
}

function requireSupabase() {
  if (supabase === null) throw new Error('Supabase is not configured — site preferences need it.');
  return supabase;
}

/**
 * This site's preferences, or the defaults.
 *
 * **No row is a valid, expected state**, not an error: the migration seeds nothing, so every
 * site starts without one and reads as all-visible. `maybeSingle()` rather than `single()` for
 * exactly that reason — `single()` treats zero rows as a failure, which would make a fresh
 * deployment log an error on every page load for a state that is entirely normal.
 */
export async function fetchSiteUi(): Promise<SiteUiRow> {
  const client = requireSupabase();
  const { data, error } = await client.from('site_ui_prefs').select('prefs').eq('site_id', SITE.id).maybeSingle();
  if (error) throw new Error(error.message);
  const raw = data?.prefs ?? null;
  return { prefs: readSiteUi(raw), raw };
}

/**
 * Saves this site's preferences, merged over whatever the row already held.
 *
 * `upsert`, because "no row yet" is the normal starting state and an update against a missing
 * row would silently affect nothing — the same PostgREST behaviour that made a schedule save
 * report success while changing nothing (see `server/proxy.mjs`'s note on affected-row counts).
 * The conflict target is `site_id`, which is the table's primary key and therefore an
 * unconditional constraint — the thing `ON CONFLICT` requires.
 */
export async function saveSiteUi(prefs: SiteUiPrefs, existingRaw: unknown, actorUserId: string | null): Promise<SiteUiRow> {
  const client = requireSupabase();
  const merged = writeSiteUi(prefs, existingRaw);
  const { data, error } = await client
    .from('site_ui_prefs')
    .upsert(
      { site_id: SITE.id, prefs: merged, updated_by: actorUserId, updated_at: new Date().toISOString() },
      { onConflict: 'site_id' },
    )
    .select('prefs')
    .maybeSingle();
  if (error) throw new Error(error.message);
  // Read back what the database actually stored rather than echoing what was sent. A write that
  // RLS silently declined would otherwise leave the UI showing a preference nobody has.
  const raw = data?.prefs ?? merged;
  return { prefs: readSiteUi(raw), raw };
}

export { SITE_UI_DEFAULTS };
