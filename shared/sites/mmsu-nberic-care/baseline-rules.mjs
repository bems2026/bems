/**
 * The rules this building's projected baseline is built by — RM-153.
 *
 * Hand-written, and the only hand-written input to `baseline.mjs`, which `npm run baseline:build`
 * generates from these rules and the recorded hours. Change a rule here, rebuild, and commit both.
 * Every decision below is the operator's, stated on 2026-09-30, or a day the data itself rules out;
 * `server/baselineModel.mjs` describes how each is applied, and `docs/adr/ADR-0012-projected-baseline.md`
 * why.
 *
 * Data only — no imports, no logic.
 */
export const BASELINE_RULES = Object.freeze({
  /**
   * 25 Aug – 22 Sep 2026: four weeks and a day. Every branch meter recorded 99.4–99.6% of its minutes,
   * and neither auto-shed nor the aircon loop issued a command until 23 Sep — the manual's own baseline
   * rule (`docs/90-replication.md`: four weeks, automation not acting, at least 99% of minutes). The
   * schedules that fired in it were tests. Before 25 Aug the archive holds 27% of 16–24 Aug.
   */
  window: Object.freeze({ from: '2026-08-25', to: '2026-09-22' }),

  /** What the Recorded view keeps, used or not: 16 Aug, the archive's first day, to 30 Sep. */
  record: Object.freeze({ from: '2026-08-16', to: '2026-09-30' }),

  /** Days the data rules out, each with what happened. Holidays in `SITE.non_working_days` and days
   * an automation source acted are excluded without being listed here. Evidence: E-231. */
  excluded: Object.freeze({
    '2026-08-31': Object.freeze({ reason: 'National Heroes Day (public holiday), and devices hand-tested', evidence: 'E-231' }),
    '2026-09-01': Object.freeze({ reason: 'office evidently closed: 1.4 kWh all day, and the aircon never ran', evidence: 'E-231' }),
    '2026-09-03': Object.freeze({ reason: 'two site power cycles and a nine-hour device outage', evidence: 'E-231' }),
    '2026-09-07': Object.freeze({ reason: 'every device hand-tested, and Node-RED restarted', evidence: 'E-231' }),
    '2026-09-21': Object.freeze({ reason: 'meter channel swaps and two Pi reboots (an outage test)', evidence: 'E-231' }),
    '2026-09-22': Object.freeze({ reason: 'aircon loop acceptance test walked the setpoint down to 16 °C; office power cycle', evidence: 'E-231' }),
    '2026-09-26': Object.freeze({ reason: 'the device outage of RM-146: switches, outlets and the IR hub dark while the branch meters kept recording', evidence: 'E-231' }),
    '2026-09-27': Object.freeze({ reason: 'the device outage of RM-146: switches, outlets and the IR hub dark while the branch meters kept recording', evidence: 'E-231' }),
    '2026-09-28': Object.freeze({ reason: 'the device outage of RM-146: switches, outlets and the IR hub dark while the branch meters kept recording', evidence: 'E-231' }),
    '2026-09-29': Object.freeze({ reason: 'the device outage of RM-146: switches, outlets and the IR hub dark while the branch meters kept recording', evidence: 'E-231' }),
  }),

  /** Hours of an otherwise good day that are not. */
  dropped_hours: Object.freeze({
    '2026-08-26': Object.freeze({ hours: Object.freeze([8, 9, 10]), reason: 'meters reported online but froze, 08:21–10:39' }),
  }),

  /**
   * Which recorded weekdays each modelled day feeds (0 = Sunday). Friday feeds none: the operator
   * ruled it a full working day, and the recorded Fridays were lighter, so it is modelled on
   * Monday–Thursday. Saturday is modelled as recorded — some Saturday work is this office's routine.
   */
  day_types: Object.freeze({
    working: Object.freeze({ label: 'Working day', recorded_weekdays: Object.freeze([1, 2, 3, 4]) }),
    saturday: Object.freeze({ label: 'Saturday', recorded_weekdays: Object.freeze([6]) }),
    sunday: Object.freeze({ label: 'Sunday', recorded_weekdays: Object.freeze([0]) }),
  }),

  /** The modelled week, Sunday first: Monday–Friday working. */
  modelled_week: Object.freeze(['sunday', 'working', 'working', 'working', 'working', 'working', 'saturday']),

  weekday_notes: Object.freeze({
    5: 'Friday is modelled as a full working day, on the Monday–Thursday profile (the operator, 2026-09-30)',
  }),

  /** The Recorded view's averages, by the weekday as it actually was. */
  recorded_groups: Object.freeze([
    Object.freeze({ key: 'mon_thu', label: 'Monday–Thursday', weekdays: Object.freeze([1, 2, 3, 4]) }),
    Object.freeze({ key: 'friday', label: 'Friday', weekdays: Object.freeze([5]) }),
    Object.freeze({ key: 'saturday', label: 'Saturday', weekdays: Object.freeze([6]) }),
    Object.freeze({ key: 'sunday', label: 'Sunday', weekdays: Object.freeze([0]) }),
  ]),

  /** A day any of these acted on is not business as usual. */
  automation_sources: Object.freeze(['dsm_autoshed', 'acu_loop']),

  /** With five or more days, drop each hour's highest and lowest day. */
  trim_from_days: 5,

  /** A day needs this many hours recorded on every meter. */
  min_hours_recorded: 20,

  /** An hourly average above this, on one branch meter, is a register fault — `SITE.telemetry_bounds.power_w.max`. */
  ceiling_w: 25_000,
});
