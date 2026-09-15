import type { Carboned, Costed } from '@/lib/energyCost';
import type { Coverage } from '@/lib/supabaseReports';
import { isQuotable } from '@/lib/supabaseReports';
import type { Section } from './useReportData';

/**
 * What the period cost and what it emitted — with the provenance on the same line.
 *
 * THREE RULES, AND THEY ARE WHY THIS IS A COMPONENT RATHER THAN A TEMPLATE STRING.
 *
 * 1. **Never a zero.** An unset tariff renders the sentence "no rate has been entered", not
 *    ₱0.00. A zero cost is a claim that electricity was free, and it is the single most damaging
 *    number this page could print.
 * 2. **The cost inherits the kilowatt-hours' coverage qualifier verbatim.** If the energy is a
 *    floor because the month was half observed, the cost is a floor and says so. A figure that
 *    is qualified upstream and bare downstream is worse than one that was never qualified.
 * 3. **Provenance travels with it.** Every figure names the rate, the date it took effect, where
 *    it came from and who entered it. That is the whole reason the tariff lives in a table with a
 *    required `source` rather than in a config file, and a peso figure without it is exactly what
 *    a funder cannot check.
 */

interface Props {
  cost: Costed;
  carbon: Carboned;
  coverage: Coverage | null;
  /**
   * Whether the rates themselves have been read — RM-081. Rule 1 above says an unset tariff reads
   * "no rate has been entered"; that sentence is a claim about the database, and a read that is
   * still loading or that FAILED has not established it. Omitted, the figures are taken as read.
   */
  pricing?: Pick<Section<unknown>, 'status' | 'error' | 'retry'>;
}

const money = (v: number, currency: string) =>
  `${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;

export function CostCarbonLine({ cost, carbon, coverage, pricing }: Props) {
  const qualified = !isQuotable(coverage);

  if (pricing && pricing.status !== 'ready') {
    const failed = pricing.status === 'error';
    return (
      <>
        <div>
          <dt>Cost</dt>
          <dd>
            <span className="reports-figure reports-figure--missing">
              {failed ? '— the rates could not be loaded' : 'Loading the rates…'}
            </span>
            {failed ? (
              <>
                {pricing.error ? <span className="reports-figure__caveat"> ({pricing.error})</span> : null}{' '}
                <button type="button" className="report-retry-btn" onClick={pricing.retry}>
                  Retry
                </button>
              </>
            ) : null}
          </dd>
        </div>
        <div>
          <dt>Emissions</dt>
          <dd>
            <span className="reports-figure reports-figure--missing">
              {failed ? '— the emission factors could not be loaded' : 'Loading the emission factors…'}
            </span>
          </dd>
        </div>
      </>
    );
  }

  return (
    <>
      <div>
        <dt>Cost</dt>
        <dd>
          {cost.total === null ? (
            <span className="reports-figure reports-figure--missing">
              {cost.mixedCurrency
                ? '— rates in more than one currency, so they do not sum'
                : '— no rate has been entered'}
            </span>
          ) : (
            <span className={`reports-figure${qualified ? ' reports-figure--qualified' : ''}`}>
              {money(cost.total, cost.currency ?? '')}
              {qualified ? <span className="reports-figure__caveat"> (partial period)</span> : null}
            </span>
          )}
          {cost.unpricedKwh > 0 ? (
            <span className="reports-figure__caveat">
              {' '}
              · {cost.unpricedKwh.toFixed(2)} kWh fell before the earliest rate and is not priced
            </span>
          ) : null}
        </dd>
      </div>

      <div>
        <dt>Emissions</dt>
        <dd>
          {carbon.total === null ? (
            <span className="reports-figure reports-figure--missing">— no emission factor has been entered</span>
          ) : (
            <span className={`reports-figure${qualified ? ' reports-figure--qualified' : ''}`}>
              {carbon.total.toFixed(1)} kgCO₂e
              {qualified ? <span className="reports-figure__caveat"> (partial period)</span> : null}
            </span>
          )}
        </dd>
      </div>

      {cost.byRate.length > 0 || carbon.byFactor.length > 0 ? (
        <div className="report-provenance">
          <dt>Sources</dt>
          <dd>
            <ul>
              {cost.byRate.map((r) => (
                <li key={`r-${r.effectiveFrom}`}>
                  {r.ratePerKwh} {cost.currency}/kWh from {r.effectiveFrom} — priced {r.kwh.toFixed(2)} kWh.{' '}
                  <em>{r.source}</em>
                  {r.setByLabel ? `, entered by ${r.setByLabel}` : ''}.
                </li>
              ))}
              {carbon.byFactor.map((f) => (
                <li key={`f-${f.effectiveFrom}`}>
                  {f.kgPerKwh} kgCO₂e/kWh from {f.effectiveFrom} — applied to {f.kwh.toFixed(2)} kWh.{' '}
                  <em>{f.source}</em>
                  {f.setByLabel ? `, entered by ${f.setByLabel}` : ''}.
                </li>
              ))}
            </ul>
          </dd>
        </div>
      ) : null}
    </>
  );
}
