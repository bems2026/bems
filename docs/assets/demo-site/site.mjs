/**
 * The building the README's screenshots are taken in. It does not exist.
 *
 * WHY IT IS HERE AND NOT IN `shared/sites/`: this is documentation fixture, not framework code.
 * `docs/assets/capture.mjs` copies these three files into a throwaway git worktree, points that
 * worktree's `shared/siteConfig.mjs` at them, and screenshots the result — so the front page
 * shows a neutral building rather than whichever one this checkout happens to be deployed in,
 * and no file in your working tree is touched to do it.
 *
 * It doubles as a worked example. `npm run site:new` scaffolds these three files empty, on
 * purpose — it will not invent facts about a building it has never seen. This is what they look
 * like once somebody has filled them in.
 */
export const SITE = Object.freeze({
  id: 'demo-building',
  display_name: 'Demo Building',

  /** A site declares both, and `test/site-config.test.mjs` asserts they agree at a real instant. */
  timezone: 'UTC',
  utc_offset_minutes: 0,

  /** Above this, a branch's daily energy is treated as a fault rather than a reading. */
  max_branch_kwh_per_day: 100,

  /**
   * `null`, which is the normal case. A scene pack is a hand-surveyed 3D/floor layout built for
   * one room; a deployment that has not commissioned one gets the data-driven plan view instead,
   * and that is what these screenshots show.
   */
  scene_pack: null,

  /** Only the weather cards read this. No API key: Open-Meteo needs none. */
  location: Object.freeze({
    place: 'Demo City',
    lat: 14.5995,
    lon: 120.9842,
  }),

  policy: Object.freeze({
    /** The floor the server enforces on every air-conditioning setpoint, above the hardware's own. */
    acu_min_setpoint_c: 24,
    /** `local-first` tries the LAN and falls back to the vendor cloud; `local-only` never leaves. */
    dispatch: 'local-first',
  }),
});
