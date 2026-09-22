/**
 * Guards supabase/phase47_held_minutes.sql — FI-027's second half.
 *
 * WHY THIS FILE EXISTS. RM-133 stored `measurement_frozen` with every row the bridge flagged, and RM-134's
 * scrub stamps `scrub.rule = 'held_reading'` on rows that stored a figure nobody re-read. Until phase47 the
 * reports counted those minutes as recorded and averaged their held watts. Decided by the operator on
 * 2026-09-22: a held minute is not a recorded minute, its power is left out of every power figure, and its
 * energy is untouched — that comes from the meter's own register, which was right.
 *
 * File-text tests, like phase44's. `supabase/rehearse.sh` runs the counts, the rollup and the restatement
 * on a real Postgres; this checks what the rehearsal cannot see:
 *   - every report function changed ONLY its online filters: put `r.online` back where the predicate
 *     stands and each is the earlier file's text, byte for byte, so no energy expression can have moved;
 *   - the energy filters were NOT changed — a held row's register is the device's own count;
 *   - the rollup excludes held rows from its power figures and its `online_sample_count`, and counts them;
 *   - the predicate reads the two flags and nothing else, and the grants follow the earlier files.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p) => readFileSync(join(ROOT, ...p), 'utf8').replace(/\r\n/g, '\n');
const PATH = join(ROOT, 'supabase', 'phase47_held_minutes.sql');

const file = existsSync(PATH) ? read('supabase', 'phase47_held_minutes.sql') : '';
/** Statements only — negative assertions must not trip over a comment that names what is avoided. */
const sql = file.replace(/--[^\n]*/g, '');

const PRED = 'public.reading_measured(r.online, r.capabilities)';

/** The text of one `create ... function` through its closing `<tag>;`, with `create function` normalised. */
function functionText(text, name) {
  const start = text.search(new RegExp(`create (or replace )?function public\\.${name}\\(`, 'i'));
  assert.ok(start > -1, `${name} is not defined`);
  const tag = text.slice(start).match(/as (\$[a-z]*\$)/)[1];
  const open = text.indexOf(tag, start) + tag.length;
  const end = text.indexOf(`${tag};`, open);
  assert.ok(end > -1, `${name} has no closing ${tag};`);
  return text.slice(start, end + tag.length + 1).replace(/^create function/i, 'create or replace function');
}

/** The report functions and the file each one was last defined in. */
const REPORTS = {
  report_hour_profile: 'phase37_report_series.sql',
  report_device_daily_energy: 'phase42_bounded_device_energy.sql',
  report_recorded_minutes_devices: 'phase44_recorded_minutes.sql',
  generate_monthly_report: 'phase44_recorded_minutes.sql',
  report_hour_energy: 'phase46_daily_reports.sql',
  generate_period_report: 'phase46_daily_reports.sql',
};

test('phase47 exists', () => {
  assert.ok(file.length > 0, 'supabase/phase47_held_minutes.sql is missing');
});

test('the predicate: online, and neither flagged frozen nor restated as a held reading', () => {
  const text = functionText(file, 'reading_measured');
  assert.match(text, /reading_measured\(p_online boolean, p_capabilities jsonb\)/);
  assert.match(text, /returns boolean/);
  assert.match(text, /\bimmutable\b/, 'immutable, so the planner can inline it into every aggregate');
  assert.match(text, /'measurement_frozen'/);
  assert.match(text, /'held_reading'/);
  assert.match(text, /coalesce\(p_online, false\)/, 'a null `online` is not a measurement');
  assert.match(sql, /revoke execute on function public\.reading_measured\(boolean, jsonb\) from public, anon;/);
  assert.match(sql, /grant\s+execute on function public\.reading_measured\(boolean, jsonb\) to authenticated, service_role;/);
});

for (const [name, source] of Object.entries(REPORTS)) {
  test(`${name}: only its online filters changed from ${source}`, () => {
    const now = functionText(file, name);
    assert.ok(now.includes(PRED), `${name} does not use the predicate`);
    const before = functionText(read('supabase', source), name);
    assert.equal(now.split(PRED).join('r.online'), before);
  });

  test(`${name}: every remaining online-only filter is an energy register`, () => {
    for (const line of functionText(file, name).split('\n')) {
      if (/filter \(where r\.online\)/.test(line)) assert.match(line, /energy_kwh_today/, `not an energy line: ${line.trim()}`);
    }
  });
}

test('the rollup: held rows leave the power figures and online_sample_count, and are counted', () => {
  const text = functionText(file, 'roll_up_and_prune_readings');
  assert.match(text, /public\.reading_measured\(r\.online, r\.capabilities\) as measured/);
  for (const col of ['power_w', 'voltage', 'current']) {
    assert.match(text, new RegExp(`sum\\(s\\.${col} \\* s\\.weight_s\\) filter \\(where s\\.measured\\)`), `${col} average`);
  }
  assert.match(text, /max\(s\.power_w\)\s+filter \(where s\.measured\)/);
  assert.match(text, /max\(s\.energy_kwh_today\)\s+filter \(where s\.online\)/, 'the register is kept for held rows');
  assert.match(text, /count\(\*\) filter \(where s\.measured\)::int,\s*\n\s*count\(\*\) filter \(where s\.online and not s\.measured\)::int/);
  assert.match(text, /online_sample_count, held_sample_count/);
  assert.match(sql, /alter table readings_hourly add column if not exists held_sample_count int;/);
});

test('the rollup changed only those lines from phase31', () => {
  let now = functionText(file, 'roll_up_and_prune_readings');
  const undo = (a, b) => {
    assert.ok(now.includes(a), `expected in phase47: ${a.trim().slice(0, 80)}`);
    now = now.split(a).join(b);
  };
  undo('    energy_kwh_today_max, sample_count, online_sample_count, held_sample_count\n', '    energy_kwh_today_max, sample_count, online_sample_count\n');
  undo('           r.online,\n           public.reading_measured(r.online, r.capabilities) as measured,\n', '           r.online,\n');
  undo('         count(*) filter (where s.measured)::int,\n         count(*) filter (where s.online and not s.measured)::int\n', '         count(*) filter (where s.online)::int\n');
  now = now.split('filter (where s.measured)').join('filter (where s.online)');
  now = now.split('filter (where s.measured and ').join('filter (where s.online and ');
  assert.equal(now, functionText(read('supabase', 'phase31_readings_hourly_time_weighted.sql'), 'roll_up_and_prune_readings'));
});

test('the grants are the earlier files\', restated', () => {
  for (const [name, source] of [...Object.entries(REPORTS), ['roll_up_and_prune_readings', 'phase31_readings_hourly_time_weighted.sql']]) {
    const lines = read('supabase', source).split('\n').filter((l) => /^(revoke|grant)\s+execute on function/.test(l) && l.includes(`public.${name}(`));
    assert.ok(lines.length > 0, `${source} has no grants for ${name}`);
    for (const l of lines) assert.ok(sql.includes(l.trim()), `phase47 does not restate: ${l.trim()}`);
  }
});

test('the restatement keeps what a stored row first said, and touches only rows that change', () => {
  const block = sql.slice(sql.indexOf('do $$'));
  assert.ok(block.length > 5, 'no restatement block');
  assert.match(block, /online_sample_count_before\s*=\s*coalesce\(r\.online_sample_count_before, r\.online_sample_count\)/, 'a second restatement keeps the first figure');
  assert.match(block, /coverage_restated_at\s*=\s*now\(\)/);
  assert.match(block, /is distinct from/, 'a row already right is left alone');
  assert.doesNotMatch(block, /energy_kwh\s*=/, 'energy is never restated');
  assert.doesNotMatch(block, /generated_at\s*=/);
});

test('nothing a rehearsal would miss: no policy, trigger or table rewrite', () => {
  assert.doesNotMatch(sql, /create policy|create trigger/i);
  assert.doesNotMatch(sql, /generated always as/i, 'a stored generated column would rewrite readings under a lock');
  assert.doesNotMatch(sql, /alter table (public\.)?readings\b/i);
});
