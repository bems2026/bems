import { describe, it, expect } from 'vitest';
import { buildDocDefinition, type PdfReport } from './docDefinition';
import { NOT_SAID } from '@shared/reportProse.mjs';

/**
 * The document, asserted as a value.
 *
 * `docDefinition.ts` does not import pdfmake, and that is the whole point: the definition is a
 * plain object, so every property this file cares about can be checked without rendering a byte.
 * What a renderer would add is fidelity, and fidelity is what the manual check on the Pi is for.
 *
 * The assertions are about honesty rather than layout. A PDF is the artefact that leaves the
 * building — it gets attached to an email, printed, quoted in a report to the university — and
 * it is the one rendering nobody can ask a follow-up question of.
 */

const FULL = 31 * 24 * 60;

const report = (o: Partial<PdfReport> = {}): PdfReport => ({
  title: 'Energy report',
  siteName: 'MMSU CARE Office',
  timezone: 'Asia/Manila',
  generatedAt: '10 September 2026, 16:04',
  periodLabel: 'August 2026',
  buildId: 'index-DBofVb9f.js',
  summary: {
    n: 12006,
    p50_w: 99.8,
    p95_w: 1632.7,
    p99_w: 3250.2,
    max_w: 4551.3,
    min_w: 5.3,
    observed_minutes: 21421,
    usable_minutes: 12006,
    expected_minutes: FULL,
    longest_gap_minutes: 23549,
    resolution: 'minute',
  },
  observedDays: 16,
  completeDays: 6,
  energyKwh: 90.9468,
  // Null by default, which is the live state: no tariff has been entered. That makes the
  // "no currency anywhere" assertion below a real check rather than a vacuous one.
  cost: null,
  carbon: null,
  provenance: [],
  charts: [{ title: 'Energy per day', svg: '<svg xmlns="http://www.w3.org/2000/svg"/>', desc: 'Nine days.', table: { headers: ['Day', 'kWh'], rows: [['17', '14.68'], ['18', null]] } }],
  deviceRows: [
    { name: 'C.O Yellow meter', energyKwh: '51.13', peakW: '4551', avgW: '318', coverage: '48%' },
    { name: 'Light Switch 1', energyKwh: null, peakW: null, avgW: null, coverage: '—' },
  ],
  caveats: NOT_SAID,
  ...o,
});

/** Walks the whole content tree, returning every string it holds. */
function allText(node: unknown, out: string[] = []): string[] {
  if (typeof node === 'string') out.push(node);
  else if (Array.isArray(node)) node.forEach((n) => allText(n, out));
  else if (node && typeof node === 'object') Object.values(node).forEach((v) => allText(v, out));
  return out;
}

const index = (def: ReturnType<typeof buildDocDefinition>, needle: string) =>
  def.content.findIndex((node) => allText(node).some((t) => t.includes(needle)));

describe('the cover', () => {
  it('names the building, the period and when it was made', () => {
    const text = allText(buildDocDefinition(report()).content).join(' | ');
    expect(text).toContain('MMSU CARE Office');
    expect(text).toContain('August 2026');
    expect(text).toContain('10 September 2026, 16:04');
    expect(text).toContain('Asia/Manila');
  });

  it('says the times are the building own, not the reader\'s', () => {
    // The CLI report opens with this sentence for the same reason: a PDF is read somewhere
    // else, and a timestamp with no frame is read in the reader's.
    expect(allText(buildDocDefinition(report()).content).join(' ')).toMatch(/building'?s own/i);
  });

  it('carries the build it was made by, so a figure can be traced back', () => {
    expect(allText(buildDocDefinition(report()).content).join(' ')).toContain('index-DBofVb9f.js');
  });
});

describe('the ordering is the argument', () => {
  it('puts coverage before any figure it qualifies', () => {
    // Asserted as an ordering property, not by eyeballing the output. A report that leads with
    // a total and footnotes the coverage has said the quotable thing first.
    const def = buildDocDefinition(report());
    expect(index(def, 'Coverage')).toBeGreaterThan(-1);
    expect(index(def, 'Coverage')).toBeLessThan(index(def, '90.95'));
  });

  it('closes with what the report does not say', () => {
    const def = buildDocDefinition(report());
    const last = allText(def.content[def.content.length - 1]).join(' ');
    expect(last).toMatch(/not normalised by floor area/i);
  });
});

describe('coverage says both figures, and the gap between them', () => {
  it('reports minutes with a real reading separately from minutes with a row', () => {
    // 27% against 48%. Showing only the second overstates by twenty-one points; showing only
    // the first disagrees with the stored report the same page prints.
    const text = allText(buildDocDefinition(report()).content).join(' ');
    expect(text).toContain('12,006');
    expect(text).toContain('21,421');
  });

  it('reports the longest gap, and says it is unmeasurable rather than zero', () => {
    const withGap = allText(buildDocDefinition(report()).content).join(' ');
    expect(withGap).toContain('23,549');

    const noRaw = report({ summary: { ...report().summary!, longest_gap_minutes: null } });
    const text = allText(buildDocDefinition(noRaw).content).join(' ');
    expect(text).toMatch(/not measurable|—/);
    expect(text).not.toMatch(/\b0 min/);
  });

  it('qualifies the resolution the figures were computed at', () => {
    const hourly = report({ summary: { ...report().summary!, resolution: 'hour' } });
    expect(allText(buildDocDefinition(hourly).content).join(' ')).toMatch(/hourly averages/i);
  });
});

describe('tables', () => {
  it('repeats its header across a page break', () => {
    const def = buildDocDefinition(report());
    const tables: { headerRows?: number }[] = [];
    const walk = (n: unknown) => {
      if (Array.isArray(n)) n.forEach(walk);
      else if (n && typeof n === 'object') {
        const t = (n as { table?: { headerRows?: number } }).table;
        if (t) tables.push(t);
        Object.values(n).forEach(walk);
      }
    };
    walk(def.content);
    expect(tables.length).toBeGreaterThan(0);
    tables.forEach((t) => expect(t.headerRows).toBe(1));
  });

  it('renders a missing device figure as an em dash, never as zero', () => {
    const def = buildDocDefinition(report());
    const text = allText(def.content).join(' | ');
    expect(text).toContain('Light Switch 1');
    // The unmetered switch's row holds dashes, and no zero was invented for it.
    expect(text).not.toMatch(/Light Switch 1 \| 0/);
  });
});

describe('charts', () => {
  it('embeds each chart as vector SVG with its data table beneath', () => {
    const def = buildDocDefinition(report());
    const svgs: unknown[] = [];
    const walk = (n: unknown) => {
      if (Array.isArray(n)) n.forEach(walk);
      else if (n && typeof n === 'object') {
        if ('svg' in n) svgs.push(n);
        Object.values(n).forEach(walk);
      }
    };
    walk(def.content);
    expect(svgs).toHaveLength(1);
    // The numbers travel with the picture: a printed chart cannot be hovered.
    expect(allText(def.content).join(' ')).toContain('14.68');
  });
});

describe('the footer', () => {
  it('numbers every page against the total', () => {
    // A function, so it cannot be asserted as data — call it.
    const def = buildDocDefinition(report());
    expect(allText(def.footer(2, 5)).join(' ')).toContain('2 of 5');
  });

  it('names the building and period on every page, because pages get separated', () => {
    const def = buildDocDefinition(report());
    const text = allText(def.footer(1, 3)).join(' ');
    expect(text).toContain('MMSU CARE Office');
    expect(text).toContain('August 2026');
  });
});

describe('it never invents a number it does not have', () => {
  it('renders a period with no summary without inventing figures', () => {
    // Both absences are stated, and neither becomes a zero. A 0.00 kWh month reads as a building
    // that used nothing, which is the one thing this whole page is built to refuse.
    const def = buildDocDefinition(report({ summary: null, energyKwh: null }));
    const text = allText(def.content).join(' ');
    expect(text).toMatch(/No coverage figures have been generated/i);
    expect(text).toMatch(/No energy figure has been generated/i);
    expect(text).not.toMatch(/0\.00 kWh/);
  });

  it('says no rate has been entered rather than printing a zero', () => {
    // A zero cost is a claim that electricity was free. In a document that leaves the building
    // it is the most damaging number on the page, and the one a reader repeats without caveats.
    const text = allText(buildDocDefinition(report()).content).join(' ');
    expect(text).toMatch(/no rate has been entered/i);
    expect(text).toMatch(/no emission factor has been entered/i);
    expect(text).not.toMatch(/0\.00 [A-Z]{3}/);
    expect(text).not.toMatch(/[₱$€£]/);
  });

  it('prints the cost with its provenance once a rate exists', () => {
    const withRate = report({
      cost: { text: '1,039.20 PHP', qualified: false },
      carbon: { text: '63.1 kgCO2e', qualified: false },
      provenance: ['11.4286 PHP/kWh from 2026-08-01, priced 90.95 kWh — MMSU bill, August 2026, entered by alice@example.test.'],
    });
    const text = allText(buildDocDefinition(withRate).content).join(' ');
    expect(text).toContain('1,039.20 PHP');
    expect(text).toContain('63.1 kgCO2e');
    // The source travels with the figure. A peso number a reader cannot trace to a bill is
    // exactly what a funder cannot check.
    expect(text).toContain('MMSU bill, August 2026');
    expect(text).toContain('alice@example.test');
  });

  it('inherits the energy qualifier rather than presenting a floor as a total', () => {
    // If the kWh is a floor because the month was half observed, so is the cost.
    const partial = report({ cost: { text: '500.00 PHP', qualified: true }, carbon: null });
    expect(allText(buildDocDefinition(partial).content).join(' ')).toMatch(/500\.00 PHP \(partial period\)/);
  });
});
