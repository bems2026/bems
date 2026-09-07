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
   * The most a single branch circuit here may plausibly consume in one day, in kWh.
   *
   * A backstop, not a budget. `buildLatest` publishes each meter's daily energy from the
   * device's own counter, and nothing in one sample can tell a real busy day from a register
   * carrying an offset nobody cleared — which is exactly what happened on 2026-09-03, when
   * L.O Yellow reported 3,625 kWh for a circuit that averages 36 W. Beyond this bound the
   * integrated value is preferred, and if that is implausible too the field is omitted rather
   * than guessed at.
   *
   * Sized against the building, not the fault: the whole metered load averages 919 W and its
   * measured demand ceiling is 2.21 kW, so any single branch running flat out all day is well
   * under 100. Raise it if a site adds a genuinely large single circuit — the cost of it being
   * too low is a dropped reading, which is visible, and the cost of it being too high is a
   * fabricated one, which is not.
   */
  max_branch_kwh_per_day: 100,

  /**
   * The same question for the whole building, in kWh — the ceiling on `building_totals`.
   *
   * Not the branch figure times the branch count: the branches are not all running flat out on
   * the same day, and a bound assembled that way describes an arithmetic possibility rather
   * than a building. Sized against what this one does — its highest metered day in 22 days of
   * recording is 21.8 kWh, and its highest instantaneous demand 4.55 kW, which sustained for
   * a full day would be 109 kWh. 500 needs 20.8 kW held for 24 hours, which this office cannot
   * do. `server/scrubTelemetry.mjs` multiplies this out for the weekly and monthly columns
   * rather than making a site restate them, so raising this one number cannot leave a stale
   * weekly ceiling behind that rejects the site's own real data.
   */
  max_building_kwh_per_day: 500,

  /**
   * What a single telemetry field may physically be here — the backstop `server/ingest.mjs`
   * had none of.
   *
   * WHY THE VENDOR CATALOGUE CANNOT SERVE. `shared/deviceCapabilities.mjs` carries `min`/`max`
   * for settings and diagnostics, and declares NONE for `cur_power`, `cur_voltage` or
   * `cur_current` — the three that matter. The vendor describes its protocol; only the site
   * knows what its own wiring can do.
   *
   * SIZED TO REJECT THE IMPOSSIBLE, NOT THE UNUSUAL. Measured over 610,989 readings across 22
   * days, the fleet's extremes are 241.8 V, 15.974 A, 3,091 W per device and 4,551 W for the
   * building. Every bound below clears its measured extreme with room to spare, because the
   * two errors are not symmetrical: a stored odd value is visible and arguable, a discarded
   * real one is gone. These exist to catch a register carrying garbage — the 3,625 kWh of
   * 2026-09-03 — not to second-guess a busy afternoon.
   *
   * THE MINIMA ASSUME NO GENERATION. Volts, amps and watts are unsigned magnitudes from CT
   * clamps on load circuits, so below zero is meaningless today. RM-026's inverter is the
   * revision that changes it: export is real negative power, and it arrives on its own bridge
   * rather than through these clamps — check that before widening anything here.
   */
  telemetry_bounds: Object.freeze({
    /** A 230 V nominal LV installation. The devices themselves are rated to 250 V, so a
     * reading above this is the meter lying, not the mains. */
    voltage: Object.freeze({ min: 0, max: 300 }),
    /** Per CT clamp, and reused for each phase total — the phase figures are these same
     * clamps summed, so a bound one of them could breach alone would not be a bound. */
    current: Object.freeze({ min: 0, max: 100 }),
    /** One branch circuit. 25 kW is 100 A at 250 V — the current bound's own ceiling. */
    power_w: Object.freeze({ min: 0, max: 25000 }),
    /** The whole building's instantaneous demand. */
    total_power_w: Object.freeze({ min: 0, max: 50000 }),
  }),

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
