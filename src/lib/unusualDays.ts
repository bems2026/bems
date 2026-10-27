/**
 * The days of a period worth a note — RM-164.
 *
 * The operator asked for a notes column on the energy-per-day table to say why a day was low, high or
 * unusual. This points at those days: each recorded day is compared with the median of the period's days of
 * the same kind (weekdays with weekdays, weekends with weekends, since the office is closed at weekends and a
 * quiet Saturday is not news). Above 1.5 times the usual is "high", below half of it is "low". A group with
 * fewer than four recorded days has no usual to compare with, and a day that recorded nothing is not judged.
 *
 * A pointer for the person writing notes, not a finding: the page says "unusual" beside the day and asks why.
 */

export type DayFlag = 'high' | 'low';

interface Day {
  local_day: string;
  energy_kwh: number | null;
  usable_sample_count: number;
}

const HIGH = 1.5;
const LOW = 0.5;
const MIN_GROUP = 4;

const isWeekend = (localDay: string) => {
  const dow = new Date(`${localDay.slice(0, 10)}T00:00:00Z`).getUTCDay();
  return dow === 0 || dow === 6;
};

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function unusualDays(days: readonly Day[]): Record<string, DayFlag> {
  const recorded = days.filter((d): d is Day & { energy_kwh: number } => d.usable_sample_count > 0 && typeof d.energy_kwh === 'number');
  const out: Record<string, DayFlag> = {};
  for (const weekend of [false, true]) {
    const group = recorded.filter((d) => isWeekend(d.local_day) === weekend);
    if (group.length < MIN_GROUP) continue;
    const usual = median(group.map((d) => d.energy_kwh));
    if (!(usual > 0)) continue;
    for (const d of group) {
      if (d.energy_kwh > usual * HIGH) out[d.local_day.slice(0, 10)] = 'high';
      else if (d.energy_kwh < usual * LOW) out[d.local_day.slice(0, 10)] = 'low';
    }
  }
  return out;
}
