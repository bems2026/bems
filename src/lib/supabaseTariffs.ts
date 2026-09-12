import { supabase } from '@/config/supabase';
import { SITE } from '@shared/siteConfig.mjs';
import type { Factor, Rate } from './energyCost';

/**
 * Reading and writing what a kilowatt-hour costs and emits — phase38.
 *
 * READING IS HERE, unlike `supabasePolicy.ts`. That module routes reads through
 * `/api/capabilities` because the ACU floor is ENFORCED BY THE PROXY, and what matters there is
 * the number the next command will actually be validated against — including when the proxy has
 * fallen back to its build value during a database outage. A tariff is enforced by nothing. It
 * is presentational, the table is the only truth, and reading it directly is correct. Said out
 * loud because otherwise somebody will "fix" this later to match the other one.
 *
 * NO UPDATE PATH, deliberately, matching the migration's RLS. A tariff row is a historical
 * claim — "from this date the rate was this, and here is where it came from". Editing one in
 * place rewrites what a past report was priced at with nothing to show it happened. Correcting
 * an entry is a delete and a re-insert, which leaves both acts attributed.
 */

function client() {
  if (!supabase) throw new Error('Supabase is not configured — tariffs are stored there.');
  return supabase;
}

interface TariffRow {
  id: string;
  effective_from: string;
  currency: string;
  rate_per_kwh: number;
  source: string;
  set_by_email: string | null;
  set_at: string;
}

interface FactorRow {
  id: string;
  effective_from: string;
  kg_co2e_per_kwh: number;
  source: string;
  set_by_email: string | null;
  set_at: string;
}

export interface TariffEntry extends Rate {
  id: string;
}
export interface FactorEntry extends Factor {
  id: string;
}

export async function getTariffs(): Promise<TariffEntry[]> {
  const { data, error } = await client()
    .from('energy_tariffs')
    .select('id,effective_from,currency,rate_per_kwh,source,set_by_email,set_at')
    .eq('site_id', SITE.id)
    .order('effective_from', { ascending: false });
  if (error) throw new Error(`Could not read the tariffs: ${error.message}`);
  return ((data ?? []) as TariffRow[]).map((r) => ({
    id: r.id,
    effective_from: r.effective_from.slice(0, 10),
    currency: r.currency,
    rate_per_kwh: Number(r.rate_per_kwh),
    source: r.source,
    set_at: r.set_at,
    set_by_label: r.set_by_email,
  }));
}

export async function getEmissionFactors(): Promise<FactorEntry[]> {
  const { data, error } = await client()
    .from('emission_factors')
    .select('id,effective_from,kg_co2e_per_kwh,source,set_by_email,set_at')
    .eq('site_id', SITE.id)
    .order('effective_from', { ascending: false });
  if (error) throw new Error(`Could not read the emission factors: ${error.message}`);
  return ((data ?? []) as FactorRow[]).map((r) => ({
    id: r.id,
    effective_from: r.effective_from.slice(0, 10),
    kg_co2e_per_kwh: Number(r.kg_co2e_per_kwh),
    source: r.source,
    set_at: r.set_at,
    set_by_label: r.set_by_email,
  }));
}

/** The signed-in address, snapshotted onto the row. `set_by` is the authoritative id and is
 *  stamped by the database from `auth.uid()`; this is the human-readable half of the same fact. */
async function actorEmail(): Promise<string | null> {
  const { data } = await client().auth.getSession();
  return data.session?.user.email ?? null;
}

export async function addTariff(input: {
  effectiveFrom: string;
  currency: string;
  ratePerKwh: number;
  source: string;
}): Promise<void> {
  // Checked here as well as in the database. Neither layer may assume the other ran — the same
  // reasoning `supabasePolicy.ts` records for the ACU floor's three separate refusals.
  if (!Number.isFinite(input.ratePerKwh) || input.ratePerKwh <= 0) {
    throw new Error('A rate must be a number greater than zero.');
  }
  if (input.source.trim() === '') {
    throw new Error('Say where this rate came from — a bill, a rate schedule, a memo. A figure with no source cannot be checked.');
  }
  const { error } = await client().from('energy_tariffs').insert({
    site_id: SITE.id,
    effective_from: input.effectiveFrom,
    currency: input.currency.trim().toUpperCase(),
    rate_per_kwh: input.ratePerKwh,
    source: input.source.trim(),
    set_by_email: await actorEmail(),
  });
  if (error) throw new Error(error.message);
}

export async function addEmissionFactor(input: {
  effectiveFrom: string;
  kgPerKwh: number;
  source: string;
}): Promise<void> {
  if (!Number.isFinite(input.kgPerKwh) || input.kgPerKwh <= 0) {
    throw new Error('An emission factor must be a number greater than zero.');
  }
  if (input.source.trim() === '') {
    throw new Error('Say where this factor came from. A figure with no source cannot be checked.');
  }
  const { error } = await client().from('emission_factors').insert({
    site_id: SITE.id,
    effective_from: input.effectiveFrom,
    kg_co2e_per_kwh: input.kgPerKwh,
    source: input.source.trim(),
    set_by_email: await actorEmail(),
  });
  if (error) throw new Error(error.message);
}

export async function removeTariff(id: string): Promise<void> {
  const { error } = await client().from('energy_tariffs').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

export async function removeEmissionFactor(id: string): Promise<void> {
  const { error } = await client().from('emission_factors').delete().eq('id', id);
  if (error) throw new Error(error.message);
}
