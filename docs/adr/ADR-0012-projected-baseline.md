---
title: ADR-0012 — The baseline is a model built from four recorded weeks, committed as a site file
status: Accepted
date: 2026-09-30
evidence: [E-125, E-157, E-206, E-231, E-232]
---

# ADR-0012 — The baseline is a model built from four recorded weeks, committed as a site file

**Status:** Accepted · **Decided:** 2026-09-30 · **Decided by:** the operator, on the RM-153 plan. **Amends:**
RM-097's word rule, for the Reports page's Baseline tab only.

## Context

- **The ask.** The operator asked for a baseline on the Reports page, with complete daily, weekly and monthly figures,
  to measure savings against. It was to show business as usual: weekdays working 08:00 to 17:00, weekends not, no
  holidays, no working from home, and no energy management acting.
- **The data was not a clean month.** August was 27% recorded before the 25th. Several days in the next four weeks
  were tests, holidays or outages [E-231].
- **Automation started acting on 23 Sep.** Anything after that is no longer business as usual [E-231].
- **The manual already had a rule.** A baseline needs at least four weeks with automation not acting, at ≥ 99% of
  expected minutes per meter [E-157]. `npm run baseline:report` already summarises a recorded window for the
  deliverable [E-206], but it describes that window, not a typical week.

## Decision

The baseline is a model built from recorded hours, and every step can be checked:

- **The rows.** Hourly averages per branch meter from 25 Aug to 22 Sep 2026, each filed under the load its circuit
  carries (Lighting, Aircon, Others).
- **The days.** Tests, holidays, outages and any day an automation source acted are left out, each with its reason.
- **The profile.** For each day type, category and hour, the mean of its days, leaving out the highest and lowest day
  once there are five or more.
- **The day types.** A working day is recorded Monday to Thursday. Friday is modelled on it (the operator's rule).
  Saturday and Sunday are as recorded.
- **The week and the month.** A week is five working days, a Saturday and a Sunday. A standard month is 365.25 / 12
  days in the same proportions.

`npm run baseline:build` builds it on the edge, read-only. It writes the site's `baseline.mjs`, which is committed
beside the rules that made it (`baseline-rules.mjs`). The Reports page imports the file and sets the selected period
against it over the period's own calendar. Holidays in the site calendar count as closed days. A period under 95%
recorded is not compared. The recorded days behind it ship in the same file, as its backup.

## Alternatives considered

| Option | Why not |
|---|---|
| Use one recorded month as the baseline | No month was clean. August was a quarter recorded before the 25th, and September held an outage and automation from the 23rd [E-231]. |
| A database table and a report function | It needs a migration and a query on every visit, and the free plan's request budget is already the tight quota (RM-149). The baseline changes when a rule changes, not per request, so a committed file serves. |
| Compute it in the browser from stored rows | The raw minutes older than 14 days live on the edge (ADR-0011). The browser would have to fetch a month of hourly rows per meter on every visit. |
| A plain mean of the days | One testing day moves an hour. With 11 working days, leaving out each hour's highest and lowest keeps 9 [E-232]. |
| Model Friday as recorded | The recorded Fridays averaged 7.1 kWh against 13.8 for the other weekdays [E-232]. The operator ruled Friday a full working day, as the brief asks. |
| Regress on weather (degree-days) | No outdoor temperature is recorded: the pilot's stand-alone outdoor sensor was never installed [E-125]. There is nothing to regress on yet. |

## Consequences

- **The Reports page says "baseline" on one tab.** RM-097 kept the word off the page. The operator named this tab,
  so the word rule now exempts the Baseline panel alone. `ReportsPage.tabs.test.tsx` still holds the other four tabs
  to it.
- **A rule change needs a rebuild.** `test/site-baseline.test.mjs` fails when the committed file no longer matches its
  rules: the window, the exclusions, the dropped hours, the day types or the method.
- **Every daemon loads the file**, through `shared/siteConfig.mjs`. It is in the restart map, and a new build takes
  effect on the page after `npm run build`.
- **A holiday is expected to use what the quietest modelled day uses.** Here that is a Sunday.
- **The comparison is a difference, not proof of a saving.** Its caveats say what it is not adjusted for.

## What would change this answer

- **A year of recordings.** A same-month baseline would then capture the seasons that this one cannot.
- **An outdoor temperature sensor, installed and kept per day.** Then regress the aircon on degree-days, as IPMVP
  Option C recommends.
- **Occupancy or equipment changes.** New aircon, a changed schedule, or a different number of staff make this
  baseline describe a different building. Rebuild it from four weeks recorded after the change, before automation acts.
- **A second site.** The model and the tab are site-agnostic. A new site's `baseline.mjs` is `null` until it is built.
