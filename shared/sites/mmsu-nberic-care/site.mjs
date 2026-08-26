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

/** @typedef {{ acu_min_setpoint_c: number|null }} SitePolicy */

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
    acu_min_setpoint_c: 25,
  }),
});
