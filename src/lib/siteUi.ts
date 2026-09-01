/**
 * Which optional cards this site shows — RM-035.
 *
 * WHY THIS EXISTS. Two cards draw a picture of a building rather than reporting a reading: the
 * Control page's "Lighting & outlet plan" and the Overview's 3D model. Both come from a
 * build-time pack surveyed in one office (`carePlan.ts`, `SITE.scene_pack`), so a site whose room
 * does not match gets a confident drawing of somewhere else. Until a site can draw its own
 * (RM-036/RM-037) it needs to be able to say "not this one".
 *
 * WHY IT IS SITE-LEVEL AND IN THE DATABASE, not a browser preference: the office kiosk is a
 * shared screen with nobody sitting at it, so a per-viewer setting could not be configured from
 * anywhere useful and would be lost on any reset. This is an operator decision about a
 * deployment, and it belongs where the operator's other decisions live.
 *
 * WHY A SEPARATE TABLE rather than a column on `sites` — see `supabase/phase24_site_ui_prefs.sql`.
 * Short version: `sites` is deliberately unwritable from the browser and carries the aircon
 * policy floor, and RLS is row-level.
 *
 * Pure. The network calls live in `supabaseSiteUi.ts`, the same split
 * `supabaseSpaceTree.ts` draws between its mappers and its requests.
 */

export interface SiteUiPrefs {
  /** Control → "Lighting & outlet plan". */
  controlPlanCard: boolean;
  /** Overview → the 3D model hero. */
  overviewSceneCard: boolean;
}

/**
 * Visible, both of them.
 *
 * The direction of the default is the load-bearing part. An existing deployment must look
 * identical the moment this table lands and before anyone opens the panel — a migration that
 * rearranges the dashboard without being asked to is exactly the surprise this project avoids
 * elsewhere. And when a value cannot be read, showing a card the operator wanted hidden is a
 * one-click annoyance, while hiding one they wanted is a control surface that vanished with
 * nothing on screen to explain it.
 */
export const SITE_UI_DEFAULTS: SiteUiPrefs = Object.freeze({
  controlPlanCard: true,
  overviewSceneCard: true,
});

/** The jsonb key for each field. snake_case, matching every other jsonb column in this schema
 * (`acu_min_setpoint_c`, `plan_x`) and the row-to-model mapping every other reader here does. */
const KEYS: Record<keyof SiteUiPrefs, string> = {
  controlPlanCard: 'control_plan_card',
  overviewSceneCard: 'overview_scene_card',
};

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * The stored blob as preferences, tolerating anything.
 *
 * Only a real `false` hides a card. `"false"`, `0` and `null` are each falsy or truthy in ways
 * that would let a hand-edited row hide something by accident, so every non-boolean is treated
 * as absent rather than coerced — the same discipline `coerceCategory` applies in
 * `deviceConfig.ts`, and the same reason `pointValue` tests `=== false` rather than falsiness.
 *
 * Falls back PER KEY. A single bad value must not reset a good one beside it.
 */
export function readSiteUi(raw: unknown): SiteUiPrefs {
  if (!isRecord(raw)) return { ...SITE_UI_DEFAULTS };
  const out = { ...SITE_UI_DEFAULTS };
  for (const field of Object.keys(KEYS) as (keyof SiteUiPrefs)[]) {
    const value = raw[KEYS[field]];
    if (typeof value === 'boolean') out[field] = value;
  }
  return out;
}

/**
 * Preferences as the blob to store, merged over what is already there.
 *
 * The merge is not defensive tidiness. This is one jsonb row shared by every client, and the
 * whole reason it is jsonb is that "a new preference must never require a migration". Without
 * the merge that promise is false the first time a newer build adds a key and an older tab saves
 * over it. `existing` is ignored unless it is genuinely an object, so a corrupted row cannot
 * spread junk into a good write.
 */
export function writeSiteUi(prefs: SiteUiPrefs, existing?: unknown): Record<string, unknown> {
  const base = isRecord(existing) ? { ...existing } : {};
  for (const field of Object.keys(KEYS) as (keyof SiteUiPrefs)[]) {
    base[KEYS[field]] = prefs[field];
  }
  return base;
}
