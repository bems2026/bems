/**
 * The projected baseline — RM-153. Pure: rows in, one frozen description of "business as usual" out.
 *
 * WHAT IT IS. What this building uses on an ordinary day when nothing is managing it: working days
 * at the site's working hours, weekends as recorded, no holidays, no automation. It is the
 * reference energy savings are measured against (avoided energy = baseline − actual), so every
 * number in it has to be traceable to recorded hours and a stated rule. `docs/adr/ADR-0012` says
 * why it is a model built from a window rather than the window itself.
 *
 * THE METHOD, in the order it is applied:
 *
 *   1. Hourly averages per meter (the archive's own 3,600 s buckets), each meter filed under the
 *      load its circuit carries (`buildingMetersByLoad`). An hour above the ceiling, or below zero,
 *      is dropped as impossible. A category-hour needs EVERY meter in the category: one of two
 *      lighting meters is not "the lighting", it is half of it.
 *   2. Days: inside the window, not excluded by rule (each with its reason), recorded on every meter
 *      for at least `min_hours_recorded` hours, not a holiday in the
 *      site calendar, and no command from an automation source that day — automation acting is
 *      precisely what a baseline must not contain. Listed hours of a day can be dropped with a
 *      reason (a meter frozen while reporting online).
 *   3. Day types. Each recorded weekday feeds one modelled day type, or none: a weekday that feeds
 *      none (here Friday, which the operator ruled a full working day) is modelled on another
 *      type and its own recordings are kept only in the recorded view.
 *   4. Per type, category and hour, the TRIMMED MEAN across its days: with five or more, the
 *      highest and lowest day are dropped, so no single testing day moves an hour. A missing
 *      hour is left out of the mean, never counted as zero.
 *   5. A week from the modelled week, and a standard month of 365.25 / 12 days in the same
 *      proportions. A calendar month uses its own weekdays — that is `src/lib/baselineCompare.ts`.
 *
 * WHAT IT IS NOT. Not weather-normalised: no outdoor temperature is recorded (the pilot's stand-alone
 * outdoor sensor was never installed), so there are no degree-days to regress on, and a hot month and a
 * mild one are held to the same aircon profile. The recorded view (`recorded`) keeps every day of
 * the span as it was, with what the baseline did with it, so the model can always be checked
 * against the data it came from.
 */

/** 365.25 / 12 — the average month, so a "month" of baseline is not a February or an August. */
export const STANDARD_MONTH_DAYS = 365.25 / 12;

const DAY_MS = 86_400_000;

/** The audit trail's source codes, in the words the Reports page uses for them. */
const SOURCE_WORDS = { dsm_autoshed: 'auto-shed', acu_loop: 'aircon loop', schedule: 'scheduled' };
const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const round = (x, places) => (x === null || !Number.isFinite(x) ? x : Math.round(x * 10 ** places) / 10 ** places);

/** Mean after dropping the highest and lowest value, once there are `trimFrom` or more. Nulls are
 * absent values, not zeros. */
export function trimmedMean(values, trimFrom) {
  const v = values.filter((x) => x !== null && x !== undefined).sort((a, b) => a - b);
  const kept = v.length >= trimFrom ? v.slice(1, -1) : v;
  return kept.length ? kept.reduce((a, x) => a + x, 0) / kept.length : null;
}

/** Linear-interpolation quantile (the spreadsheet PERCENTILE.INC definition). */
export function quantile(values, q) {
  const s = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (s.length === 0) return null;
  const i = (s.length - 1) * q;
  const lo = Math.floor(i);
  return s[lo] + (s[Math.ceil(i)] - s[lo]) * (i - lo);
}

const mean = (xs) => {
  const v = xs.filter((x) => x !== null && x !== undefined);
  return v.length ? v.reduce((a, x) => a + x, 0) / v.length : null;
};

function datesBetween(from, to) {
  const out = [];
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += DAY_MS) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

const weekdayOf = (date) => new Date(`${date}T00:00:00Z`).getUTCDay();

/** The building's local date and hour of a UTC instant. */
function localOf(ts, offsetMinutes) {
  const local = new Date(Date.parse(ts) + offsetMinutes * 60_000).toISOString();
  return { date: local.slice(0, 10), hour: Number(local.slice(11, 13)) };
}

function hourOfDay(hhmm) {
  const [h, m] = String(hhmm).split(':').map(Number);
  return h + m / 60;
}

/**
 * @param {{
 *   site: { id: string, utc_offset_minutes: number, working_hours: {start: string, end: string},
 *           non_working_days?: readonly {date: string, name: string}[] },
 *   meterLoads: readonly { load: string, meterIds: readonly string[] }[],
 *   hourly: Record<string, readonly { ts: string, power_w: number|null, online_count?: number }[]>,
 *   commands: readonly { requested_at: string, source: string }[],
 *   buildingPeaks: readonly { local_day: string, max_w: number|null }[],
 *   rules: Record<string, any>,
 *   generatedAt: string,
 * }} input
 */
export function buildBaseline({ site, meterLoads, hourly, commands, buildingPeaks, rules, generatedAt }) {
  const offset = site.utc_offset_minutes;
  const loads = meterLoads.map((g) => g.load);
  const meterLoad = new Map(meterLoads.flatMap((g) => g.meterIds.map((m) => [m, g.load])));
  const window = datesBetween(rules.window.from, rules.window.to);
  const span = datesBetween(rules.record.from, rules.record.to);
  const inWindow = new Set(window);
  const warnings = [];
  if (window.length < 28) {
    warnings.push(`the window is ${window.length} days; the manual's baseline rule asks for at least 28 days (four weeks)`);
  }

  // --- 1. hourly watts per meter, per local day and hour ---------------------------------------
  /** meter -> date -> Array(24) of W | null */
  const perMeter = new Map();
  const onlineMinutes = new Map();
  for (const [meter, rows] of Object.entries(hourly)) {
    if (!meterLoad.has(meter)) continue;
    const days = new Map();
    perMeter.set(meter, days);
    onlineMinutes.set(meter, 0);
    for (const r of rows) {
      const { date, hour } = localOf(r.ts, offset);
      if (inWindow.has(date)) onlineMinutes.set(meter, onlineMinutes.get(meter) + (r.online_count ?? 0));
      if (r.power_w === null || r.power_w === undefined || !(Number(r.online_count ?? 1) > 0)) continue;
      const w = Number(r.power_w);
      if (!Number.isFinite(w) || w < 0 || w > rules.ceiling_w) continue;
      if (!days.has(date)) days.set(date, Array(24).fill(null));
      days.get(date)[hour] = w;
    }
  }

  /** date -> load -> Array(24) of W | null; a category-hour needs every meter in it. */
  const cells = new Map();
  for (const date of span) {
    const byLoad = {};
    for (const g of meterLoads) {
      byLoad[g.load] = Array.from({ length: 24 }, (_, h) => {
        let sum = 0;
        for (const m of g.meterIds) {
          const w = perMeter.get(m)?.get(date)?.[h];
          if (w === null || w === undefined) return null;
          sum += w;
        }
        return sum;
      });
    }
    cells.set(date, byLoad);
  }

  // --- 2. which days, and why not ---------------------------------------------------------------
  const holidays = new Map((site.non_working_days ?? []).map((d) => [d.date, d.name]));
  const automation = new Map();
  for (const c of commands) {
    if (!rules.automation_sources.includes(c.source)) continue;
    const { date } = localOf(c.requested_at, offset);
    const counts = automation.get(date) ?? {};
    counts[c.source] = (counts[c.source] ?? 0) + 1;
    automation.set(date, counts);
  }
  const typeOfWeekday = new Map();
  for (const [type, def] of Object.entries(rules.day_types)) {
    for (const d of def.recorded_weekdays) typeOfWeekday.set(d, type);
  }

  /** Why an in-window day is not an ordinary recorded day, or null. The modelled-weekday rule is
   * separate: those days are ordinary, they just do not feed a projected type. */
  const hoursRecorded = (date) => {
    const byLoad = cells.get(date);
    return Array.from({ length: 24 }, (_, h) => h).filter((h) => loads.every((l) => byLoad[l][h] !== null)).length;
  };
  const unusable = (date) => {
    const rule = rules.excluded?.[date];
    if (rule) return { reason: rule.reason, evidence: rule.evidence ?? null };
    const n = hoursRecorded(date);
    if (n < rules.min_hours_recorded) {
      return { reason: `only ${n} of 24 hours recorded on every meter; the rule is ${rules.min_hours_recorded}`, evidence: null };
    }
    if (holidays.has(date)) return { reason: `holiday: ${holidays.get(date)}`, evidence: null };
    const acted = automation.get(date);
    if (acted) {
      const what = Object.entries(acted)
        .map(([s, n]) => `${n} ${SOURCE_WORDS[s] ?? s} command${n === 1 ? '' : 's'}`)
        .join(', ');
      return { reason: `automation acted: ${what}`, evidence: null };
    }
    return null;
  };

  const excluded = [];
  const typeDays = Object.fromEntries(Object.keys(rules.day_types).map((t) => [t, []]));
  const ordinary = [];
  for (const date of window) {
    const bad = unusable(date);
    if (bad) {
      excluded.push({ date, ...bad });
      continue;
    }
    ordinary.push(date);
    const type = typeOfWeekday.get(weekdayOf(date));
    if (type) {
      typeDays[type].push(date);
    } else {
      const note = rules.weekday_notes?.[weekdayOf(date)] ?? `${WEEKDAY_NAMES[weekdayOf(date)]} feeds no day type`;
      excluded.push({ date, reason: note, evidence: null });
    }
  }
  excluded.sort((a, b) => a.date.localeCompare(b.date));

  const dropped = rules.dropped_hours ?? {};
  const valueAt = (date, load, h) => (dropped[date]?.hours.includes(h) ? null : cells.get(date)?.[load]?.[h] ?? null);

  // --- 3/4. the projected day types ------------------------------------------------------------
  const whStart = hourOfDay(site.working_hours.start);
  const whEnd = hourOfDay(site.working_hours.end);
  const workingHours = Array.from({ length: 24 }, (_, h) => h).filter((h) => h >= whStart && h + 1 <= whEnd);

  const describeProfile = (profile) => {
    const kwh = Object.fromEntries(loads.map((l) => [l, round(profile[l].reduce((a, w) => a + (w ?? 0), 0) / 1000, 3)]));
    kwh.total = round(loads.reduce((a, l) => a + kwh[l], 0), 3);
    const total = Array.from({ length: 24 }, (_, h) => loads.reduce((a, l) => a + (profile[l][h] ?? 0), 0));
    const night = total.slice(0, 5).sort((a, b) => a - b);
    const inHours = workingHours.reduce((a, h) => a + total[h], 0);
    return {
      kwh,
      standby_w: round(night[Math.floor(night.length / 2)], 1),
      working_hours_avg_w: round(inHours / workingHours.length, 1),
      highest_hourly_w: round(Math.max(...total), 1),
      working_hours_share: round(kwh.total > 0 ? inHours / 1000 / kwh.total : 0, 3),
    };
  };

  const day_types = {};
  for (const [type, def] of Object.entries(rules.day_types)) {
    const days = typeDays[type];
    if (days.length === 0) {
      throw new Error(`cannot build the baseline: day type "${type}" has no days in the window`);
    }
    const profile_w = Object.fromEntries(
      loads.map((l) => [l, Array.from({ length: 24 }, (_, h) => round(trimmedMean(days.map((d) => valueAt(d, l, h)), rules.trim_from_days) ?? 0, 1))]),
    );
    day_types[type] = { label: def.label, recorded_weekdays: [...def.recorded_weekdays], days, profile_w, ...describeProfile(profile_w) };
  }

  // --- 5. week and month ------------------------------------------------------------------------
  const weekKwh = Object.fromEntries(loads.map((l) => [l, round(rules.modelled_week.reduce((a, t) => a + day_types[t].kwh[l], 0), 3)]));
  weekKwh.total = round(loads.reduce((a, l) => a + weekKwh[l], 0), 3);
  const perWeekday = STANDARD_MONTH_DAYS / 7;
  const monthKwh = Object.fromEntries(Object.entries(weekKwh).map(([k, v]) => [k, round(v * perWeekday, 3)]));
  const weekdaysOfType = {};
  for (const t of rules.modelled_week) weekdaysOfType[t] = (weekdaysOfType[t] ?? 0) + 1;
  const typeCounts = Object.fromEntries(Object.entries(weekdaysOfType).map(([t, n]) => [t, round(n * perWeekday, 3)]));

  // --- peak operating draw ----------------------------------------------------------------------
  const peakOf = new Map(buildingPeaks.filter((p) => Number.isFinite(p.max_w)).map((p) => [p.local_day, p.max_w]));
  const workingType = rules.modelled_week[site.working_week?.[0] ?? 1];
  const workingPeaks = day_types[workingType].days.map((d) => peakOf.get(d)).filter((w) => Number.isFinite(w));

  // --- the recorded backup ----------------------------------------------------------------------
  const excludedOf = new Map(excluded.map((e) => [e.date, e]));
  const recordedDays = span.map((date) => {
    const byLoad = cells.get(date);
    const kwh = Object.fromEntries(loads.map((l) => [l, round(byLoad[l].reduce((a, w) => a + (w ?? 0), 0) / 1000, 3)]));
    kwh.total = round(loads.reduce((a, l) => a + kwh[l], 0), 3);
    const hours_recorded = hoursRecorded(date);
    const type = Object.entries(typeDays).find(([, ds]) => ds.includes(date))?.[0] ?? null;
    return {
      date,
      weekday: weekdayOf(date),
      kwh,
      hours_recorded,
      highest_w: peakOf.get(date) ?? null,
      used_as: type,
      reason: type
        ? null
        : inWindow.has(date)
          ? excludedOf.get(date)?.reason ?? null
          : unusable(date)
            ? `outside the baseline window (${unusable(date).reason})`
            : 'outside the baseline window',
    };
  });
  const recordedProfiles = rules.recorded_groups.map((g) => {
    const days = ordinary.filter((d) => g.weekdays.includes(weekdayOf(d)));
    const profile_w = Object.fromEntries(
      loads.map((l) => [l, Array.from({ length: 24 }, (_, h) => round(mean(days.map((d) => valueAt(d, l, h))) ?? 0, 1))]),
    );
    return { key: g.key, label: g.label, weekdays: [...g.weekdays], days, profile_w, ...describeProfile(profile_w) };
  });

  const windowMinutes = window.length * 1440;
  const coverage = Object.fromEntries([...onlineMinutes].map(([m, n]) => [m, round(n / windowMinutes, 6)]));

  return {
    version: 1,
    site_id: site.id,
    generated_at: generatedAt,
    window: { ...rules.window, days: window.length },
    working_hours: { ...site.working_hours },
    loads,
    meters: Object.fromEntries(meterLoads.map((g) => [g.load, [...g.meterIds]])),
    method: {
      trim_from_days: rules.trim_from_days,
      min_hours_recorded: rules.min_hours_recorded,
      ceiling_w: rules.ceiling_w,
      automation_sources: [...rules.automation_sources],
      standard_month_days: STANDARD_MONTH_DAYS,
    },
    day_types,
    week: { days: [...rules.modelled_week], kwh: weekKwh },
    standard_month: {
      days: round(STANDARD_MONTH_DAYS, 4),
      working_days: typeCounts[workingType],
      day_counts: typeCounts,
      kwh: monthKwh,
    },
    peak_operating_draw: { w: round(quantile(workingPeaks, 0.9), 1), days: workingPeaks.length, quantile: 0.9 },
    excluded,
    dropped_hours: Object.entries(dropped)
      .map(([date, d]) => ({ date, hours: [...d.hours], reason: d.reason }))
      .sort((a, b) => a.date.localeCompare(b.date)),
    coverage,
    recorded: { from: rules.record.from, to: rules.record.to, days: recordedDays, profiles: recordedProfiles },
    warnings,
  };
}

/**
 * The recorded days behind the baseline, hour by hour and circuit by circuit — RM-154.
 *
 * WHY. The profiles above are each hour's average across a day type, so every projected working day
 * drew the same curve. The office's real days are not that: its eleven clean working days ran from
 * 8.3 to 21.9 kWh, each with its own shape (E-233). A projected period is built from these days
 * instead (`src/lib/baselineProjection.ts`), so a baseline week or month reads like a recorded one.
 *
 * WHAT EACH DAY HOLDS, per branch meter and hour: average W (`w`), highest W (`max`), current
 * (`a`); per hour, the meters' mean voltage (`v`) and the building's highest minute (`max_w`, from
 * `report_hour_matrix`). An hour that was dropped by rule, missing, or above the ceiling is filled
 * with the same meter-hour's mean over the type's other days, and listed in `filled`.
 *
 * ONE SCALE PER TYPE. Each type's days are multiplied by one factor so they average the type's
 * projected day (`day_types[type].kwh.total`, the trimmed profile). The spread between the days is
 * kept; the central figures the baseline publishes (a working day, a week, a month) stay the same.
 */
export function buildDonorDays({ site, baseline, hourly, buildingHours, rules }) {
  const offset = site.utc_offset_minutes;
  const meters = baseline.loads.flatMap((l) => baseline.meters[l]);
  const dropped = rules.dropped_hours ?? {};
  const fields = ['w', 'max', 'a', 'v'];
  const blank = () => Object.fromEntries(fields.map((f) => [f, Array(24).fill(null)]));
  const usable = (x) => x !== null && x !== undefined && Number.isFinite(Number(x)) && Number(x) >= 0;

  /** meter -> date -> { w, max, a, v } arrays of 24 */
  const grid = new Map(meters.map((m) => [m, new Map()]));
  for (const m of meters) {
    for (const r of hourly[m] ?? []) {
      const { date, hour } = localOf(r.ts, offset);
      if (dropped[date]?.hours.includes(hour)) continue;
      if (!(Number(r.online_count ?? 1) > 0) || !usable(r.power_w) || Number(r.power_w) > rules.ceiling_w) continue;
      const days = grid.get(m);
      if (!days.has(date)) days.set(date, blank());
      const cell = days.get(date);
      cell.w[hour] = Number(r.power_w);
      cell.max[hour] = usable(r.power_w_max) && Number(r.power_w_max) <= rules.ceiling_w ? Number(r.power_w_max) : Number(r.power_w);
      if (usable(r.current)) cell.a[hour] = Number(r.current);
      if (usable(r.voltage) && Number(r.voltage) > 0) cell.v[hour] = Number(r.voltage);
    }
  }
  const peaks = new Map();
  for (const c of buildingHours) {
    if (!usable(c.max_w)) continue;
    if (!peaks.has(c.local_day)) peaks.set(c.local_day, Array(24).fill(null));
    peaks.get(c.local_day)[c.local_hour] = Number(c.max_w);
  }

  const types = {};
  for (const [type, t] of Object.entries(baseline.day_types)) {
    const dates = t.days;
    const at = (m, date) => grid.get(m).get(date) ?? blank();
    /** The same meter-hour's mean over the type's other days; 0 when none of them has it. */
    const fillValue = (m, f, h, date) => mean(dates.filter((d) => d !== date).map((d) => at(m, d)[f][h])) ?? 0;
    const raw = dates.map((date) => {
      const filled = [];
      const perMeter = {};
      for (const m of [...meters].sort()) {
        const cell = at(m, date);
        const hours = [];
        const out = {};
        for (const f of fields) {
          out[f] = cell[f].map((x, h) => {
            if (x !== null) return x;
            if (f === 'w') hours.push(h);
            return fillValue(m, f, h, date);
          });
        }
        if (hours.length > 0) filled.push({ meter: m, hours });
        perMeter[m] = out;
      }
      const peak = peaks.get(date) ?? Array(24).fill(null);
      const max_w = peak.map((x, h) => x ?? (mean(dates.filter((d) => d !== date).map((d) => peaks.get(d)?.[h] ?? null)) ?? 0));
      const kwh = meters.reduce((a, m) => a + perMeter[m].w.reduce((x, w) => x + w, 0), 0) / 1000;
      return { date, filled, perMeter, max_w, kwh };
    });
    const plain = raw.reduce((a, x) => a + x.kwh, 0) / raw.length;
    const scale = plain > 0 ? t.kwh.total / plain : 1;
    types[type] = {
      label: t.label,
      scale: round(scale, 4),
      days: raw.map((x) => ({
        date: x.date,
        weekday: weekdayOf(x.date),
        meters: Object.fromEntries(
          meters.map((m) => [
            m,
            {
              w: x.perMeter[m].w.map((w) => round(w * scale, 1)),
              max: x.perMeter[m].max.map((w) => round(w * scale, 1)),
              a: x.perMeter[m].a.map((a) => round(a * scale, 3)),
            },
          ]),
        ),
        v: Array.from({ length: 24 }, (_, h) => round(mean(meters.map((m) => (x.perMeter[m].v[h] > 0 ? x.perMeter[m].v[h] : null))) ?? 0, 1)),
        max_w: x.max_w.map((w) => round(w * scale, 1)),
        filled: x.filled,
      })),
    };
  }
  return { version: 1, site_id: baseline.site_id, generated_at: baseline.generated_at, meters, types };
}

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const quote = (s) => `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')}'`;

function literal(value, depth) {
  const pad = '  '.repeat(depth + 1);
  const close = '  '.repeat(depth);
  if (value === null || typeof value === 'boolean') return String(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`cannot write ${value} into the baseline module`);
    return String(value);
  }
  if (typeof value === 'string') return quote(value);
  if (Array.isArray(value)) {
    if (value.every((v) => v === null || typeof v !== 'object')) return `Object.freeze([${value.map((v) => literal(v, depth)).join(', ')}])`;
    return `Object.freeze([\n${value.map((v) => `${pad}${literal(v, depth + 1)},`).join('\n')}\n${close}])`;
  }
  const entries = Object.entries(value).map(([k, v]) => `${pad}${IDENTIFIER.test(k) ? k : quote(k)}: ${literal(v, depth + 1)},`);
  return `Object.freeze({\n${entries.join('\n')}\n${close}})`;
}

/** The donor days as their own generated module — the page loads it only when a baseline is shown. */
export function renderBaselineDaysModule(days) {
  const count = Object.values(days.types).reduce((a, t) => a + t.days.length, 0);
  return `/**
 * The recorded days behind this site's projected baseline — GENERATED by \`npm run baseline:build -- --write\` (RM-154).
 *
 * Do not edit. ${count} recorded days, hour by hour and branch meter by branch meter, each type scaled once so its
 * days average the baseline's projected day; see \`buildDonorDays\` in \`server/baselineModel.mjs\`. Read through
 * \`loadBaselineDays\` in \`shared/siteConfig.mjs\`, so the browser fetches it only when a baseline is shown.
 *
 * Built ${days.generated_at}. Data only — no imports, no logic.
 */
export const BASELINE_DAYS = ${literal(days, 0)};
`;
}

/** The baseline as the generated site module: data only, frozen at every level, like `site.mjs`. */
export function renderBaselineModule(baseline) {
  return `/**
 * The projected baseline of this site — GENERATED by \`npm run baseline:build -- --write\` (RM-153).
 *
 * Do not edit. Change \`baseline-rules.mjs\` beside this file and rebuild; the method is described in
 * \`server/baselineModel.mjs\` and \`docs/adr/ADR-0012-projected-baseline.md\`.
 *
 * Built ${baseline.generated_at} from ${baseline.window.from} to ${baseline.window.to} (${baseline.window.days} days).
 * Data only — no imports, no logic.
 */
export const BASELINE = ${literal(baseline, 0)};
`;
}
