-- =============================================================================
-- Phase 54 — RM-155d. A stored "jump removed" caveat, measured as phase53's rule measures it.
--
-- WHAT WAS WRONG. phase53 changed what `removed_kwh` means. It was the day's highest counter reading less
-- the credited energy; it is now the clipped rises less what they were credited — exactly the jump that
-- was not counted. phase53 restated only the rows whose ENERGY banking changed, so a row whose energy stayed
-- the same kept its caveat measured the old way. Read back on 2026-10-01 (E-238): L.O Yellow's day of 23 Sep
-- said "a 4.75 kWh jump is not counted" while its week said 5.03, and 5.03 is the jump (0.290 -> 5.322).
--
-- WHAT THIS FILE DOES.
--   1. `period_reports` gains `energy_removed_kwh_before`, written only by step 2.
--   2. A stored device row that carries a removed figure gets it as the rule now measures it, written as
--      the generator writes it (`case when removed > 0.001`), only when:
--        - its energy is still what the rule gives (within 0.5 Wh), so the figure beside it belongs to it —
--          a row built from other data is left alone;
--        - the figure moves by more than 1 Wh.
--      `energy_removed_kwh_before` keeps what the row first said. Nothing else is touched: not the energy,
--      not `energy_restated_at`, not coverage or `generated_at`.
--
-- Expected on the live project, three rows, all L.O Yellow (E-238): 23 Sep 4.753 -> 5.032, and the counter
-- jump of 8 Sep corrected by phase42, 76.789 -> 77.197 for the day and for the week of 7 Sep.
--
-- SAFE TO RE-RUN. The column is added `if not exists`; a second paste finds every figure already right and
-- changes nothing. No function, table, policy or trigger is created and nothing is dropped, so the SQL
-- editor has nothing to stop on. Rehearsed by `supabase/rehearse.sh`, which applies it twice.
-- =============================================================================

alter table period_reports add column if not exists energy_removed_kwh_before numeric;

do $$
declare
  r record;
  n int;
  total int := 0;
begin
  for r in
    select distinct p.period, p.period_start
      from period_reports p
     where p.energy_removed_kwh is not null
     order by 1, 2
  loop
    with measured as materialized (
      select x.device_id        as dev,
             sum(x.energy_kwh)  as e,
             sum(x.removed_kwh) as removed
        from public.report_device_daily_energy(r.period, r.period_start) x
       group by x.device_id
    )
    update period_reports p
       set energy_removed_kwh_before = coalesce(p.energy_removed_kwh_before, p.energy_removed_kwh),
           energy_removed_kwh        = case when f.removed > 0.001 then f.removed end
      from measured f
     where p.period = r.period
       and p.period_start = r.period_start
       and p.device_id = f.dev
       and p.energy_removed_kwh is not null
       and p.energy_kwh is not null
       and f.e is not null
       and abs(p.energy_kwh - f.e) <= 0.0005
       and abs(p.energy_removed_kwh - coalesce(case when f.removed > 0.001 then f.removed end, 0)) > 0.001;
    get diagnostics n = row_count;
    total := total + n;
  end loop;
  raise notice 'phase54: restated the removed figure on % stored period_reports row(s)', total;
end $$;

-- So the API sees the new column now, rather than after its next schema reload.
notify pgrst, 'reload schema';
