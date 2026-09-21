/**
 * Guards supabase/phase46_daily_reports.sql — RM-124, the Daily period.
 *
 * File-text tests, like phase42's and phase44's: `supabase/rehearse.sh` runs the file on a real
 * Postgres; this checks what the rehearsal cannot see — that the restated generator is phase44's
 * text byte for byte once the listed day-branches are removed, so no week or month figure can have
 * moved; that `report_window` gained exactly the day branch; that the two check constraints now
 * admit 'day'; and that the new hourly-energy function carries phase42's credit rule and the
 * signed-in grant the page needs.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p) => readFileSync(join(ROOT, ...p), 'utf8').replace(/\r\n/g, '\n');

const file = read('supabase', 'phase46_daily_reports.sql');
const phase44 = read('supabase', 'phase44_recorded_minutes.sql');
const phase37 = read('supabase', 'phase37_report_series.sql');
const phase42 = read('supabase', 'phase42_bounded_device_energy.sql');

/** The `create or replace function public.<name>(` ... `$fn$;` block of a file. */
function fnText(src, name) {
  const start = src.indexOf(`create or replace function public.${name}(`);
  assert.ok(start >= 0, `${name} defined`);
  const end = src.indexOf('$fn$;', start);
  assert.ok(end > start, `${name} closed`);
  return src.slice(start, end + '$fn$;'.length);
}

/** The day branch of the building-energy CASE: from its own comment to the CASE's `end`. */
function dayEnergyBranch(gen) {
  const start = gen.indexOf("           -- A DAY is its own daily counter's high-water mark");
  const end = gen.indexOf("         end,\n         (select max(total_power_w_max) from totals_hours)");
  assert.ok(start > 0 && end > start, 'the day energy branch is present');
  return gen.slice(start, end);
}

test('report_window accepts a day: p_start itself, plus one day, and nothing else changed', () => {
  const now = fnText(file, 'report_window');
  const was = fnText(phase37, 'report_window');
  const undone = now
    .replace("               when 'day'   then p_start\n", '')
    .replace("          when 'day'   then (ls::timestamp + interval '1 day')   at time zone p_tz\n", '')
    .replace("expected day, week or month", 'expected week or month');
  assert.equal(undone, was, 'report_window is phase37\'s text once the day branch is removed');
  assert.match(now, /when 'day'\s+then p_start/);
});

test('generate_period_report accepts a day, and is otherwise phase44\'s text byte for byte', () => {
  const now = fnText(file, 'generate_period_report');
  const was = fnText(phase44, 'generate_period_report');
  const dayEnergy = dayEnergyBranch(now);
  assert.ok(dayEnergy.length > 0, 'the day energy branch is present');
  const undone = now
    .replace("                        when 'day'   then p_start\n", '')
    .replace("               when 'day'   then (local_start::timestamp + interval '1 day')   at time zone p_tz\n", '')
    .replace("expected day, week or month", 'expected week or month')
    .replace(dayEnergy, '');
  assert.equal(undone, was);
});

test('a day\'s building energy is its own daily counter\'s high-water mark, not a month-counter increment', () => {
  // The week's increment rule falls back to the WHOLE month-to-date when the previous day has no
  // rows — tolerable across seven days, the entire month for one. Within a single day the daily
  // counter cannot double-count a frozen meter across days, which was the only reason weeks avoid it.
  const now = fnText(file, 'generate_period_report');
  const day = dayEnergyBranch(now);
  assert.match(day, /select max\(energy_kwh_today_max\) from totals_hours/);
  assert.doesNotMatch(day, /from building_increments/);
});

test('both stored-report tables admit the new period', () => {
  for (const t of ['period_reports', 'period_building_reports']) {
    const re = new RegExp(`alter table ${t} drop constraint if exists ${t}_period_known;[\\s\\S]*?alter table ${t} add constraint ${t}_period_known\\s+check \\(period in \\('day', 'week', 'month'\\)\\)`);
    assert.match(file, re, `${t} check constraint restated with day`);
  }
});

test('report_hour_energy exists, keyed like the other series functions, and carries phase42\'s credit rule', () => {
  const fn = fnText(file, 'report_hour_energy');
  assert.match(fn, /p_period\s+text,\s*\n\s*p_start\s+date,\s*\n\s*p_tz\s+text\s+default 'Asia\/Manila',\s*\n(?:\s*--[^\n]*\n)?\s*p_device_ids text\[\] default null/);
  assert.match(fn, /from public\.report_window\(p_period, p_start, p_tz\)/);
  // The cap, the +10 % and the 5 Wh, the same three constants phase42 uses.
  assert.match(fn, /\(c\.day_peak_w \/ 1000\.0\) \* \(c\.span_h \+ 1\) \* 1\.10 \+ 0\.005 as cap_kwh/);
  assert.match(phase42, /\(c\.day_peak_w \/ 1000\.0\) \* \(c\.span_h \+ 1\) \* 1\.10 \+ 0\.005 as cap_kwh/, 'phase42 still says the same');
  // Every hour of every device in the window is a row, unobserved ones included.
  assert.match(fn, /generate_series\(0,\s*23\)/);
  // Bounded before PostgREST can truncate it.
  assert.match(fn, /raise exception 'report_hour_energy would return % rows, over the 900 cap/);
  assert.match(fn, /security invoker/);
});

test('the page may call report_hour_energy; anon may not; the generator keeps its service-role-only grant', () => {
  assert.match(file, /revoke execute on function public\.report_hour_energy\(text, date, text, text\[\]\) from public, anon;/);
  assert.match(file, /grant\s+execute on function public\.report_hour_energy\(text, date, text, text\[\]\) to authenticated, service_role;/);
  assert.match(file, /revoke execute on function public\.generate_period_report\(text, date, text\) from public;/);
  assert.match(file, /grant\s+execute on function public\.generate_period_report\(text, date, text\) to service_role;/);
});

test('the file says how to apply it and that re-running is safe', () => {
  assert.match(file, /Supabase SQL editor/);
  assert.match(file, /RE-RUNNING IS SAFE|SAFE TO RE-RUN/i);
});
