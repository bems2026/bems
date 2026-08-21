import { describe, it, expect } from 'vitest';
import { toCsv } from './csv';

const COLUMNS = [
  { key: 'device', header: 'Device' },
  { key: 'kwh', header: 'Energy (kWh)' },
] as const;

describe('toCsv', () => {
  it('writes a header row followed by one row per record', () => {
    const csv = toCsv([{ device: 'co1', kwh: 12.5 }], COLUMNS);
    expect(csv.split('\r\n')).toEqual(['Device,Energy (kWh)', 'co1,12.5']);
  });

  it('emits only the header for an empty set — a real answer, not an error', () => {
    expect(toCsv([], COLUMNS)).toBe('Device,Energy (kWh)');
  });

  it('renders a missing value as empty, never as 0', () => {
    // The rule this whole codebase follows: a missing reading and a real zero are different
    // facts. A spreadsheet that shows 0 kWh for a month nobody measured is a lie that sums.
    const csv = toCsv([{ device: 'co1', kwh: null }, { device: 'co2', kwh: 0 }], COLUMNS);
    expect(csv.split('\r\n').slice(1)).toEqual(['co1,', 'co2,0']);
  });

  it('quotes and escapes a value containing a comma, quote, or newline', () => {
    const csv = toCsv([{ device: 'Outlet 1, west', kwh: 'say "hi"' }], COLUMNS);
    expect(csv.split('\r\n')[1]).toBe('"Outlet 1, west","say ""hi"""');
  });

  it('quotes a value containing a newline without splitting the row', () => {
    const csv = toCsv([{ device: 'a\nb', kwh: 1 }], COLUMNS);
    expect(csv).toBe('Device,Energy (kWh)\r\n"a\nb",1');
  });

  it('quotes a header that needs it too', () => {
    expect(toCsv([], [{ key: 'a', header: 'Peak, W' }])).toBe('"Peak, W"');
  });

  it('neutralises a value that a spreadsheet would execute as a formula', () => {
    // CSV injection: Excel and Sheets evaluate a cell starting with = + - or @. These values
    // come from operator-editable device names (deviceConfig.ts), so they are not trusted
    // input just because they came from our own database.
    const csv = toCsv([{ device: '=1+1', kwh: '@SUM(A1)' }], COLUMNS);
    expect(csv.split('\r\n')[1]).toBe("'=1+1,'@SUM(A1)");
  });

  it('uses CRLF, which is what RFC 4180 specifies and what Excel expects', () => {
    expect(toCsv([{ device: 'a', kwh: 1 }, { device: 'b', kwh: 2 }], COLUMNS)).toContain('\r\n');
  });
});
