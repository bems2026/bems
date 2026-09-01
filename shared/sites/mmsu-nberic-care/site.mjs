/**
 * Everything that varies between one deployment of iBEMS and the next.
 *
 * A second building gets a sibling directory here and one edited line in
 * `shared/siteConfig.mjs`. Nothing else in the codebase should ever name a building.
 *
 * Data only — no imports, no logic. This module is read by the frontend bundle (via the
 * `@shared` Vite alias), by the server daemons, and indirectly by the generated Node-RED flow,
 * so it has to be safe in all three.
 */

/** @typedef {{ acu_min_setpoint_c: number|null, dispatch: 'local-first'|'local-only' }} SitePolicy */

export const SITE = Object.freeze({
  id: 'mmsu-nberic-care',
  display_name: 'MMSU CARE Office / NBERIC',

  /** IANA zone. Consumed by the monthly report's day-grouping, which is why it has to agree
   * with the offset below. */
  timezone: 'Asia/Manila',

  /**
   * Minutes east of UTC.
   *
   * Redundant with `timezone` on purpose: the payload transform runs inside a Node-RED
   * function node with no imports and no guarantee of a full-ICU build, so it needs a plain
   * number rather than a zone name. `test/site-config.test.mjs` measures the zone at two
   * instants six months apart and asserts they agree — which is what makes carrying the same
   * fact twice safe rather than merely convenient.
   *
   * A site in a DST-observing zone cannot describe itself honestly with a fixed offset, and
   * that test is where it will find out.
   */
  utc_offset_minutes: 480,

  /**
   * Which 3D scene pack renders for this site, or null for none. Consumed in RM-032; declared
   * now so the field does not have to be retrofitted into every site directory later.
   */
  scene_pack: 'care',

  /**
   * Where this building is — RM-033.
   *
   * WHY IT MOVED HERE. `src/config/weather.ts` held these coordinates as its own defaults, so a
   * deployment that had not set `VITE_WEATHER_*` showed **this** office's weather labelled as
   * its own — a measurement about somewhere else, presented as being about the reader's
   * building. Null is now the honest answer for a site nobody has located, and the weather card
   * says so instead of borrowing a city.
   *
   * `place` is what the UI names beside the reading, so the reader can never mistake an outdoor
   * forecast for one of the building's own sensors.
   *
   * Environment variables still override, for a deployment whose weather station is sensibly
   * somewhere other than the building itself.
   */
  location: Object.freeze({
    place: 'Batac City',
    lat: 18.0553,
    lon: 120.5646,
  }),

  /** @type {SitePolicy} Operating rules for this building. */
  policy: Object.freeze({
    /**
     * The coldest setpoint this building permits, from the university's energy-efficiency
     * policy ("not lower than 25 degrees").
     *
     * NOT the same fact as `ACU_MIN_C` in `shared/commands.mjs`, and the distinction is
     * load-bearing: that one is what the IR library actually has codes for — a hardware
     * capability — while this is what the operator allows. A site with no such rule sets this
     * to null and gets the hardware bound alone.
     */
    // 24, not 25: the operator states this is what the university's policy says. Corrected
    // 2026-09-01. This is now only the DEFAULT — RM-038 made the live floor a `sites` row the
    // bridge reads and a settings screen can change, so a future revision needs no code change.
    // This value applies to a fresh deployment, and to this one whenever the database cannot be
    // read (see `server/livePolicy.mjs` for why the fallback runs in that direction).
    acu_min_setpoint_c: 24,

    /**
     * Which dispatch paths this building permits.
     *
     * `local-first` — try the LAN, fall back to the vendor cloud only after a local failure.
     * `local-only`  — the LAN or nothing.
     *
     * THIS SITE IS `local-first`, AND THAT IS ALREADY WHAT HAPPENS. The Tuya fleet sits on the
     * Pi's own 2.4 GHz segment and answers its local keys, so commanding it needs no internet
     * whatsoever; `server/dispatchLight.mjs` has always tried that path first and only reached
     * the cloud after it failed. Verified on the live fleet 2026-09-01: of 19 flow nodes, 16
     * held a local session, and the three that did not were offline to Tuya's own cloud too —
     * genuinely off the network rather than unreachable locally.
     *
     * So why declare it. Until now local-first was a property of the code rather than a
     * decision on record, and the fallback was enabled purely because credentials happened to
     * exist in `server/.env`. A building that wants no vendor in its control path at all had no
     * way to say so and no way to prove it afterwards. `local-only` is not a new dispatch path
     * — it is the ability to REFUSE the fallback, which is a different guarantee from never
     * having configured it.
     *
     * Before setting `local-only`, read `docs/adr-002-device-recovery-path.md`: the fallback
     * exists for one real failure this fleet has, where a device's inbound socket table is
     * exhausted so it stops answering locally while its outbound cloud connection stays
     * healthy. Removing the fallback means that state is recovered by walking to a breaker.
     */
    dispatch: 'local-first',
  }),
});
