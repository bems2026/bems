/**
 * Guards supabase/phase42_bounded_device_energy.sql — RM-091.
 *
 * WHY THIS FILE EXISTS. A period's per-device energy was the sum of each local day's highest counter
 * value, so a register that jumped 67 kWh while its lighting circuit drew 49 W (2026-09-08) put 81.406
 * kWh into a week whose highest draw was 251.2 W. phase42 bounds each hour's rise by what the circuit
 * could have drawn, redefines both generators to sum that, and corrects the one stored row.
 *
 * File-text tests, like phase41's. `supabase/rehearse.sh` runs the rule on a real Postgres against six
 * fixture days; this checks what the rehearsal cannot see:
 *   - the two generators changed ONLY their per-device energy — their building halves are the earlier
 *     files' text, byte for byte, so the building figure every report leads with cannot have moved;
 *   - the correction writes three columns of one table and nothing else, and only rows it can prove;
 *   - the constants are the ones `src/lib/boundedEnergy.ts` uses, so the page and the database cannot
 *     disagree about what "impossible" means.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p) => readFileSync(join(ROOT, ...p), 'utf8').replace(/\r\n/g, '\n');

const file = read('supabase', 'phase42_bounded_device_energy.sql');
const phase27 = read('supabase', 'phase27_period_reports.sql');
const phase12 = read('supabase', 'phase12_monthly_reports.sql');
const boundedTs = read('src', 'lib', 'boundedEnergy.ts');

/** Statements only — negative assertions must not trip over a comment that names what is avoided. */
const sql = file.replace(/--[^\n]*/g, '');

/** The text of one `create ... function` through its closing `$fn$;`. */
function functionText(text, name) {
  const start = text.search(new RegExp(`create (or replace )?function public\\.${name}\\(`, 'i'));
  assert.ok(start > -1, `${name} is not defined`);
  const end = text.indexOf('$fn$;', text.indexOf('$fn$', start) + 4);
  assert.ok(end > -1, `${name} has no closing $fn$;`);
  return text.slice(start, end + 5);
}

/** From `-- Building-wide.` to the diagnostics line that closes that statement. */
function buildingHalf(fnText, label) {
  const start = fnText.indexOf('  -- Building-wide.');
  const end = fnText.indexOf('get diagnostics n_building = row_count;', start);
  assert.ok(start > -1 && end > -1, `${label}: the building statement was not found`);
  return fnText.slice(start, end);
}

/** Everything up to `with hours as (` — the signature, the declarations and the window. */
function preamble(fnText) {
  const end = fnText.indexOf('  with hours as (');
  assert.ok(end > -1, 'the per-device statement should still open with the hours CTE');
  return fnText.slice(0, end);
}

/** The `hours` CTE, through the end of its `group by`. */
function hoursCte(fnText) {
  const start = fnText.indexOf('  with hours as (');
  const end = fnText.indexOf('     group by 1, 2\n  ),', start);
  assert.ok(start > -1 && end > -1, 'the hours CTE was not found');
  return fnText.slice(start, end);
}

for (const [name, source, label] of [
  ['generate_period_report', phase27, 'phase27'],
  ['generate_monthly_report', phase12, 'phase12'],
]) {
  test(`${name}: its building half is ${label}'s text, byte for byte`, () => {
    const now = functionText(file, name);
    const before = functionText(source, name);
    assert.equal(buildingHalf(now, 'phase42'), buildingHalf(before, label));
  });

  test(`${name}: its signature, declarations and hours are ${label}'s, unchanged`, () => {
    const now = functionText(file, name);
    const before = functionText(source, name);
    assert.equal(preamble(now), preamble(before));
    assert.equal(hoursCte(now), hoursCte(before));
  });

  test(`${name}: per-device energy is summed from the bounded function, joined once`, () => {
    const now = functionText(file, name).replace(/--[^\n]*/g, '');
    assert.match(now, /bounded as materialized \(\s*select b\.device_id\s+as dev,\s*sum\(b\.energy_kwh\)\s+as energy_kwh,/);
    assert.match(now, /from public\.report_device_daily_energy\(/);
    assert.match(now, /left join bounded bd on bd\.dev = d\.device_id/);
    assert.doesNotMatch(now, /sum\(day_kwh\)/, 'the high-water-mark sum must be gone');
    assert.doesNotMatch(now, /\bdaily as \(/, 'the unbounded daily CTE must be gone');
  });
}

test('the period generator keeps what was removed beside the figure, and never writes the restatement stamp', () => {
  const now = functionText(file, 'generate_period_report').replace(/--[^\n]*/g, '');
  assert.match(now, /case when bd\.removed_kwh > 0\.001 then bd\.removed_kwh end/);
  assert.match(now, /energy_removed_kwh\s+= excluded\.energy_removed_kwh/);
  assert.doesNotMatch(now, /energy_restated_at/);
});

test('both generators keep their signatures and stay the service role’s alone', () => {
  assert.match(sql, /create or replace function public\.generate_period_report\(\s*p_period text,\s*p_start\s+date,\s*p_tz\s+text default 'Asia\/Manila'\s*\)\s*returns table \(device_rows int, building_rows int\)/i);
  assert.match(sql, /create or replace function public\.generate_monthly_report\(\s*p_month date,\s*p_tz\s+text default 'Asia\/Manila'\s*\)\s*returns table \(device_rows int, building_rows int\)/i);
  assert.match(sql, /revoke execute on function public\.generate_period_report\(text, date, text\) from public;/);
  assert.match(sql, /grant\s+execute on function public\.generate_period_report\(text, date, text\) to service_role;/);
  assert.match(sql, /grant\s+execute on function public\.generate_monthly_report\(date, text\) to service_role;/);
  assert.doesNotMatch(sql, /generate_(period|monthly)_report\([^)]*\) to [^;]*authenticated/);
});

test('the daily function is dropped by its signature first, runs as its caller, and is not for anonymous readers', () => {
  const drop = sql.indexOf('drop function if exists public.report_device_daily_energy(text, date, text, text[]);');
  const create = sql.search(/create function public\.report_device_daily_energy\(/);
  assert.ok(drop > -1 && create > drop, 'drop by exact signature before create');
  const fn = functionText(file, 'report_device_daily_energy');
  assert.match(fn, /\bstable\b/);
  assert.match(fn, /security invoker/);
  assert.doesNotMatch(fn, /security definer/);
  assert.match(sql, /revoke execute on function public\.report_device_daily_energy\(text, date, text, text\[\]\) from public, anon;/);
  assert.match(sql, /grant\s+execute on function public\.report_device_daily_energy\(text, date, text, text\[\]\) to authenticated, service_role;/);
  assert.match(sql, /grant\s+execute on function public\.report_window\(text, date, text\) to service_role;/);
  assert.equal(/\bcascade\b/i.test(sql), false, 'nothing here is dropped by cascade');
});

test('the rule walks each device’s own local day in time order, over every calendar day', () => {
  const fn = functionText(file, 'report_device_daily_energy').replace(/--[^\n]*/g, '');
  assert.match(fn, /window win as \(partition by s\.dev, s\.d order by s\.bucket\)/);
  assert.match(fn, /lag\(s\.e_max\)\s+over win/);
  assert.match(fn, /generate_series\(/);
  assert.match(fn, /from devs v\s+cross join days dd/);
  // The falling counter credits nothing, and the clip credits the measured power under the cap.
  assert.match(fn, /when k\.rise <= 0 then 0/);
  assert.match(fn, /least\(k\.cap_kwh, coalesce\(k\.avg_w, 0\) \/ 1000\.0 \* k\.span_h\)/);
});

test('the cap uses the same constants as the page', () => {
  const factor = /export const CEILING_FACTOR = ([\d.]+);/.exec(boundedTs)?.[1];
  const slack = /export const CEILING_SLACK_KWH = ([\d.]+);/.exec(boundedTs)?.[1];
  const noteworthy = /export const REMOVED_NOTEWORTHY_KWH = ([\d.]+);/.exec(boundedTs)?.[1];
  assert.ok(factor && slack && noteworthy, 'boundedEnergy.ts should export all three constants');
  const cap = /\(c\.day_peak_w \/ 1000\.0\) \* \(c\.span_h \+ 1\) \* ([\d.]+) \+ ([\d.]+) as cap_kwh/.exec(sql);
  assert.ok(cap, 'the cap expression was not found');
  assert.equal(Number(cap[1]), Number(factor));
  assert.equal(Number(cap[2]), Number(slack));
  assert.match(sql, new RegExp(`bd\\.removed_kwh > ${noteworthy.replace('.', '\\.')}`));
});

test('the new columns are added to period_reports only, and only if missing', () => {
  assert.match(sql, /alter table period_reports add column if not exists energy_removed_kwh numeric;/);
  assert.match(sql, /alter table period_reports add column if not exists energy_restated_at timestamptz;/);
  assert.doesNotMatch(sql, /alter table (monthly_reports|period_building_reports|monthly_building_reports)/);
});

test('the correction writes three columns of one table, only rows it can prove, and deletes nothing', () => {
  const tail = sql.slice(sql.lastIndexOf('do $$'));
  // `do update set` is an upsert inside a generator, not a table being updated.
  const updates = [...sql.matchAll(/\bupdate\s+(?!set\b)(\w+)/gi)].map((m) => m[1].toLowerCase());
  assert.deepEqual(updates, ['period_reports']);
  assert.doesNotMatch(sql, /\bdelete\s+from\b/i);
  const set = /set\s+([\s\S]*?)\s+from found f/.exec(tail);
  assert.ok(set, 'the correction update was not found');
  const columns = set[1].split(',').map((s) => s.trim().split(/\s*=/)[0]).sort();
  assert.deepEqual(columns, ['energy_kwh', 'energy_removed_kwh', 'energy_restated_at']);
  assert.match(tail, /and f\.removed > 0\.001/);
  assert.match(tail, /and p\.energy_removed_kwh is null/);
  assert.match(tail, /and abs\(p\.energy_kwh - f\.counters\) <= 0\.01/);
  assert.match(tail, /and p\.energy_kwh - f\.removed >= 0/);
});

test('it tells the API about the new function and columns', () => {
  assert.match(sql, /notify pgrst, 'reload schema';/);
});
