import { useCallback, useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { supabase } from '@/config/supabase';
import { SITE } from '@shared/siteConfig.mjs';
import { siteDate } from '@/lib/siteTime';
import {
  addEmissionFactor,
  addTariff,
  getEmissionFactors,
  getTariffs,
  removeEmissionFactor,
  removeTariff,
  type FactorEntry,
  type TariffEntry,
} from '@/lib/supabaseTariffs';

/**
 * What a kilowatt-hour costs, and what it emits.
 *
 * THE SOURCE FIELD IS THE POINT OF THIS SCREEN, not the number. A rate typed in without saying
 * where it came from becomes an unattributable figure in a document going to a university — the
 * most quotable number in it and the least checkable. Save is disabled until the source is
 * filled, and the hint says why rather than just refusing.
 *
 * ENTRIES ARE DATED AND ADDITIVE. A rate is a historical claim: "from this date, this was the
 * rate". Adding a new one does not replace the old one — it takes over from its own date, and a
 * report of a past month keeps being priced at what was true then. There is deliberately no edit:
 * correcting a mistake is a delete and a re-entry, so both acts stay attributed.
 */

type Draft = { effectiveFrom: string; value: string; source: string; currency: string };

const today = () => new Date().toISOString().slice(0, 10);
/**
 * The currency starts EMPTY, not at 'PHP'. The migration deliberately refuses to default it —
 * "a default of 'PHP' would be the kind of assumption RM-033 spent a track removing" — and
 * pre-filling the form with one here would make exactly that assumption at every other
 * deployment, just a layer further out where no constraint can catch it.
 */
const blank = (): Draft => ({ effectiveFrom: today(), value: '', source: '', currency: '' });

export function TariffSection() {
  const [tariffs, setTariffs] = useState<TariffEntry[] | null>(null);
  const [factors, setFactors] = useState<FactorEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tariffDraft, setTariffDraft] = useState<Draft>(blank);
  const [factorDraft, setFactorDraft] = useState<Draft>(blank);
  const [busy, setBusy] = useState(false);

  const canEdit = supabase !== null;

  const load = useCallback(() => {
    if (!supabase) return;
    Promise.all([getTariffs(), getEmissionFactors()])
      .then(([t, f]) => {
        setTariffs(t);
        setFactors(f);
      })
      .catch((e) => setError(String(e instanceof Error ? e.message : e)));
  }, []);

  useEffect(load, [load]);

  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (!canEdit) {
    return (
      <section className="settings__panel">
        <h2 className="card-title">Tariff &amp; emissions</h2>
        <p className="reports-note">
          These are stored in the database, which is not configured in this build.
        </p>
      </section>
    );
  }

  const provenance = (e: { source: string; set_by_label: string | null; set_at: string }) =>
    `${e.source}${e.set_by_label ? ` · entered by ${e.set_by_label}` : ''} on ${siteDate(e.set_at)}`;

  return (
    <section className="settings__panel">
      <h2 className="card-title">Tariff &amp; emissions</h2>
      <p className="reports-note">
        What a kilowatt-hour costs and what it emits. Both are dated: a report of a past month is
        priced at what was true that month, not at today&rsquo;s rate. Until one is entered, reports
        say so rather than showing a zero.
      </p>

      {error ? (
        <p className="reports-note reports-note--error" role="alert">
          {error}
        </p>
      ) : null}

      {/* --- tariff --- */}
      <h3 className="tariff-heading">Electricity rate</h3>
      {tariffs === null ? (
        <p className="reports-note">Loading…</p>
      ) : tariffs.length === 0 ? (
        <p className="reports-note">No rate has been entered, so reports cannot state a cost.</p>
      ) : (
        <ul className="tariff-list">
          {tariffs.map((t) => (
            <li key={t.id}>
              <span className="tariff-list__figure">
                {t.rate_per_kwh} {t.currency}/kWh
              </span>
              <span className="tariff-list__from">from {t.effective_from}</span>
              <span className="tariff-list__prov">{provenance(t)}</span>
              <button
                type="button"
                className="tariff-list__remove"
                aria-label={`Remove the rate effective from ${t.effective_from}`}
                disabled={busy}
                onClick={() => act(() => removeTariff(t.id))}
              >
                <Trash2 size={14} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="tariff-form">
        <label>
          <span>Effective from</span>
          <input
            type="date"
            value={tariffDraft.effectiveFrom}
            onChange={(e) => setTariffDraft({ ...tariffDraft, effectiveFrom: e.target.value })}
          />
        </label>
        <label>
          <span>Rate per kWh</span>
          <input
            type="number"
            step="0.0001"
            min="0"
            inputMode="decimal"
            value={tariffDraft.value}
            onChange={(e) => setTariffDraft({ ...tariffDraft, value: e.target.value })}
          />
        </label>
        <label>
          <span>Currency</span>
          <input
            type="text"
            maxLength={3}
            value={tariffDraft.currency}
            onChange={(e) => setTariffDraft({ ...tariffDraft, currency: e.target.value.toUpperCase() })}
          />
        </label>
        <label className="tariff-form__source">
          <span>Where this came from</span>
          <input
            type="text"
            // From SITE, not typed in. `test/site-naming.test.mjs` refused the literal, and
            // rightly: a placeholder is shipped text, and this one would name the wrong
            // institution at every other deployment the replication framework stands up.
            placeholder={`e.g. ${SITE.display_name} electricity bill — total ÷ kWh billed`}
            value={tariffDraft.source}
            onChange={(e) => setTariffDraft({ ...tariffDraft, source: e.target.value })}
          />
        </label>
        <button
          type="button"
          className="devices-add-btn"
          disabled={
            busy ||
            tariffDraft.source.trim() === '' ||
            tariffDraft.value.trim() === '' ||
            tariffDraft.currency.trim().length !== 3
          }
          onClick={() =>
            act(async () => {
              await addTariff({
                effectiveFrom: tariffDraft.effectiveFrom,
                currency: tariffDraft.currency,
                ratePerKwh: Number(tariffDraft.value),
                source: tariffDraft.source,
              });
              setTariffDraft(blank());
            })
          }
        >
          Add rate
        </button>
      </div>
      <p className="reports-note">
        A rate with no source becomes an unattributable number in a document. Say where it came
        from &mdash; a bill, a rate schedule, a memo.
      </p>

      {/* --- emission factor --- */}
      <h3 className="tariff-heading">Grid emission factor</h3>
      {factors === null ? (
        <p className="reports-note">Loading…</p>
      ) : factors.length === 0 ? (
        <p className="reports-note">No factor has been entered, so reports cannot state emissions.</p>
      ) : (
        <ul className="tariff-list">
          {factors.map((f) => (
            <li key={f.id}>
              <span className="tariff-list__figure">{f.kg_co2e_per_kwh} kgCO₂e/kWh</span>
              <span className="tariff-list__from">from {f.effective_from}</span>
              <span className="tariff-list__prov">{provenance(f)}</span>
              <button
                type="button"
                className="tariff-list__remove"
                aria-label={`Remove the factor effective from ${f.effective_from}`}
                disabled={busy}
                onClick={() => act(() => removeEmissionFactor(f.id))}
              >
                <Trash2 size={14} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="tariff-form">
        <label>
          <span>Effective from</span>
          <input
            type="date"
            value={factorDraft.effectiveFrom}
            onChange={(e) => setFactorDraft({ ...factorDraft, effectiveFrom: e.target.value })}
          />
        </label>
        <label>
          <span>kgCO₂e per kWh</span>
          <input
            type="number"
            step="0.0001"
            min="0"
            inputMode="decimal"
            value={factorDraft.value}
            onChange={(e) => setFactorDraft({ ...factorDraft, value: e.target.value })}
          />
        </label>
        <label className="tariff-form__source">
          <span>Where this came from</span>
          <input
            type="text"
            placeholder="e.g. the national grid emission factor published by your energy department, with its year"
            value={factorDraft.source}
            onChange={(e) => setFactorDraft({ ...factorDraft, source: e.target.value })}
          />
        </label>
        <button
          type="button"
          className="devices-add-btn"
          disabled={busy || factorDraft.source.trim() === '' || factorDraft.value.trim() === ''}
          onClick={() =>
            act(async () => {
              await addEmissionFactor({
                effectiveFrom: factorDraft.effectiveFrom,
                kgPerKwh: Number(factorDraft.value),
                source: factorDraft.source,
              });
              setFactorDraft(blank());
            })
          }
        >
          Add factor
        </button>
      </div>
    </section>
  );
}
