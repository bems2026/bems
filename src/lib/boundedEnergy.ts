import type { PeriodDeviceReport } from './supabaseReports';

/**
 * A meter's counter may not add more energy than its circuit could have drawn — RM-090.
 *
 * THE FAULT THIS EXISTS FOR. On 2026-09-08 L.O Yellow's energy register jumped 0.111 -> 67.391 kWh at
 * 02:36 while the circuit drew 49 W, and reached 77.502 by the end of the day. RM-052 repaired the
 * bridge, but the stored readings kept the jump, and a weekly report is the sum of each day's
 * high-water mark — so the week of 2026-09-07 was generated as 81.406 kWh for a lighting circuit whose
 * highest draw all week was 251.2 W. Drawing 251.2 W for every one of its 168 hours is 42.2 kWh.
 *
 * THE RULE, IN ONE PLACE PER LANGUAGE. `supabase/phase42_bounded_device_energy.sql` computes the stored
 * reports with exactly this rule, and `test/phase42-bounded-device-energy-schema.test.mjs` holds its
 * constants to these. For each device and local day, over the hours that carry a counter, in order:
 *
 *   rise   = this hour's highest counter value − the previous hour's (0 at local midnight)
 *   span   = hours since the previous hour with a counter; the first runs from midnight to its end
 *   cap    = the day's highest power × (span + 1 h) × 1.10 + 0.005 kWh — the most it could have drawn
 *   credit = 0 when the counter fell (a restart or a repaired base: the next rise counts from there);
 *            the hour's own average power × span when the rise is over the cap, never more than the cap;
 *            the rise itself otherwise
 *
 * A healthy counter only ever rises by what was drawn, so its credits sum to its high-water mark and
 * the rule changes nothing. Replayed against every stored device-day on 2026-09-16 — 250 of them,
 * outlets and aircon included — it changed exactly one: that day, 77.502 -> 0.713 kWh, where the
 * circuit's own power readings integrate to 0.708.
 *
 * NOT AN ESTIMATE OF A HEALTHY DAY. Power is only ever credited for an hour whose counter has already
 * proven impossible, and RM-077's lesson (power integration overcounts while a meter is frozen) is why
 * it is never used for anything else.
 */

export const CEILING_FACTOR = 1.1;
export const CEILING_SLACK_KWH = 0.005;
/** Below this, a removal is rounding, and saying "corrected" about it would be noise. */
export const REMOVED_NOTEWORTHY_KWH = 0.001;

const HOUR_MS = 3_600_000;

/** One hour of one device, as the hourly rollup and the raw readings both reduce to it. */
export interface HourAgg {
  hourStartMs: number;
  /** The hour's highest `energy_kwh_today` while online; null when no online row carried one. */
  energyMaxKwh: number | null;
  powerAvgW: number | null;
  powerMaxW: number | null;
}

export interface ClippedHour {
  hourStartMs: number;
  riseKwh: number;
  creditedKwh: number;
  /** The highest power the circuit showed that day, which the cap was built from. */
  dayPeakW: number;
}

export interface BoundedDay {
  /** The day's energy, bounded. `null` when no hour carried a counter — never 0. */
  energyKwh: number | null;
  /** The counter's own high-water mark — what the report used to sum. */
  counterKwh: number | null;
  /** `counter − energy` on a day an hour was clipped; `null` when nothing was. */
  removedKwh: number | null;
  clipped: ClippedHour[];
}

const finite = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v);

/** The rule above, for one local day. `dayStartMs` is that day's local midnight, as an instant. */
export function boundDay(hours: readonly HourAgg[], dayStartMs: number): BoundedDay {
  const peaks = hours.map((x) => x.powerMaxW).filter(finite);
  const dayPeakW = peaks.length > 0 ? Math.max(...peaks) : null;
  const counted = hours.filter((x) => finite(x.energyMaxKwh)).sort((a, b) => a.hourStartMs - b.hourStartMs);
  if (counted.length === 0) return { energyKwh: null, counterKwh: null, removedKwh: null, clipped: [] };

  let energy = 0;
  let counter = -Infinity;
  const clipped: ClippedHour[] = [];
  let prevE = 0;
  let prevStart = dayStartMs - HOUR_MS;

  for (const hour of counted) {
    const e = hour.energyMaxKwh as number;
    counter = Math.max(counter, e);
    const span = (hour.hourStartMs - prevStart) / HOUR_MS;
    const rise = e - prevE;
    if (rise > 0) {
      const cap = dayPeakW === null ? null : (dayPeakW / 1000) * (span + 1) * CEILING_FACTOR + CEILING_SLACK_KWH;
      if (dayPeakW !== null && dayPeakW > 0 && cap !== null && rise > cap) {
        const credited = Math.min(cap, ((hour.powerAvgW ?? 0) / 1000) * span);
        energy += credited;
        clipped.push({ hourStartMs: hour.hourStartMs, riseKwh: rise, creditedKwh: credited, dayPeakW });
      } else {
        energy += rise;
      }
    }
    prevE = e;
    prevStart = hour.hourStartMs;
  }

  return {
    energyKwh: energy,
    counterKwh: counter,
    removedKwh: clipped.length > 0 ? Math.max(counter - energy, 0) : null,
    clipped,
  };
}

export type PeriodEnergyCheck = 'ok' | 'impossible' | 'unjudged';

/**
 * A stored period figure against the most the device could have drawn across the whole period: its
 * highest power for every hour of it. Deliberately loose — it uses the period's full length, so energy
 * counted across an outage still passes — and it still refuses the live 81.406 kWh, whose limit is 46.4.
 *
 * This is what keeps the page right before phase42 is applied, and against any fault nobody has seen
 * yet. It judges nothing it has no peak for.
 */
export function periodEnergyCheck(row: Pick<PeriodDeviceReport, 'energy_kwh' | 'peak_power_w' | 'expected_sample_count'>): PeriodEnergyCheck {
  const { energy_kwh: energy, peak_power_w: peak, expected_sample_count: expected } = row;
  if (!finite(energy) || !finite(peak) || peak <= 0 || !finite(expected) || expected <= 0) return 'unjudged';
  const limit = (peak / 1000) * (expected / 60) * CEILING_FACTOR + CEILING_SLACK_KWH;
  return energy > limit ? 'impossible' : 'ok';
}

export type EnergyFlag = { kind: 'impossible' } | { kind: 'corrected'; removedKwh: number; restatedAt: string | null };

/** What the page must say beside a stored figure, if anything. */
export function energyFlagOf(row: PeriodDeviceReport): EnergyFlag | null {
  if (periodEnergyCheck(row) === 'impossible') return { kind: 'impossible' };
  const removed = row.energy_removed_kwh;
  if (finite(removed) && removed > REMOVED_NOTEWORTHY_KWH) {
    return { kind: 'corrected', removedKwh: removed, restatedAt: row.energy_restated_at ?? null };
  }
  return null;
}

/** The figure to add, share and chart — `null` when the stored one is impossible. */
export function usableEnergy(row: PeriodDeviceReport): number | null {
  return periodEnergyCheck(row) === 'impossible' ? null : row.energy_kwh;
}

/** The words a flag carries, the same on the page, in the CSV and in the PDF. */
export function energyFlagText(flag: EnergyFlag): string {
  return flag.kind === 'impossible'
    ? 'Not possible: more than this circuit’s highest draw could deliver, so it is left out'
    : `Corrected: a ${flag.removedKwh.toFixed(2)} kWh jump in the meter’s counter is not counted`;
}
