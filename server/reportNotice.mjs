/**
 * FI-011 — the monthly report, pushed through the alert channel EX-103 already built.
 *
 * WHY THIS IS ALLOWED TO EXIST. FI-011 rejected email and Google Sheets delivery, and the reasoning
 * stands: an SMTP credential or a service-account key would have to live next to a public checkout,
 * to solve a problem the CSV download already solves. What it left open was "a second consumer of the
 * alert channel", and that is this. ntfy needs no account; the only secret is a topic name.
 *
 * MONTHLY ONLY. Weekly reports are generated too (RM-041), and four pushes a month is how a channel
 * gets muted — after which the fleet alarm it also carries goes unread. The month is the thing that
 * gets reported upward; the week is for noticing a change, on a page.
 *
 * WHAT IT MAY NOT SAY. The stored `online_sample_count` counts ROWS WRITTEN, not rows that held a
 * reading — RM-073 is still open on that, and August 2026 is 48% by rows against 27% by readings. So
 * this never calls that share "readings coverage": it names it as expected samples, and the page
 * remains where the qualified figures are. The rest is the page's own rules carried into one line of
 * text: a partial month's total is a floor, a stored zero from nothing observed is not a measurement,
 * and a missing figure is said rather than printed as a zero.
 */

/** English month names, not the reader's locale: this channel's other prose (`fleetMessage`) is
 *  English, and a month name in a different language inside an English sentence reads as a bug. The
 *  page formats in the reader's own locale, which is where the reader owns the formatting. */
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const finite = (v) => typeof v === 'number' && Number.isFinite(v);

/** `2026-08-01` -> `August 2026`; the bare date back if it is not one. */
export function monthLabel(periodStart) {
  const iso = String(periodStart ?? '').slice(0, 10);
  const [year, month] = iso.split('-');
  const name = MONTHS[Number(month) - 1];
  return name ? `${name} ${year}` : iso;
}

/**
 * What the push says about one stored monthly report.
 *
 * @param row a `period_building_reports` row
 * @returns `{ title, body, priority }`, the shape `notify` takes
 */
export function reportNotice(row) {
  const label = monthLabel(row.period_start);
  const expected = finite(row.expected_sample_count) ? row.expected_sample_count : 0;
  const online = finite(row.online_sample_count) ? row.online_sample_count : 0;
  const share = expected > 0 ? online / expected : null;
  const lines = [];

  if (online === 0) {
    // Not "0.00 kWh". A stored zero from a month nobody watched is not a measurement of an idle
    // building, and a push is exactly where that distinction gets lost.
    lines.push(`Not observed: no sample of ${label} carried a reading, so the stored total is not a measurement of the building.`);
  } else if (!finite(row.energy_kwh)) {
    lines.push(`No energy figure was stored for ${label}.`);
  } else {
    const parts = [`${row.energy_kwh.toFixed(2)} kWh`];
    if (finite(row.peak_total_power_w)) parts.push(`peak ${(row.peak_total_power_w / 1000).toFixed(2)} kW`);
    lines.push(parts.join(' · '));
  }

  if (share !== null && share < 0.95) {
    lines.push(
      `${Math.round(share * 100)}% of ${label}'s expected samples were recorded, so that total is a floor rather than the month's consumption.`
    );
  }
  lines.push('Open Reports on the dashboard for the figures with their coverage.');

  return { title: `iBEMS: the ${label} report is ready`, body: lines.join('\n\n'), priority: 'default' };
}

/**
 * The notices for the months a pass generated, oldest first.
 *
 * One query for the whole pass, and a month whose row does not come back is skipped rather than
 * announced from what the generator was asked to build — the figures have to come from what was
 * actually stored, or the push is a claim nobody checked.
 *
 * @param {{ client: { select: Function }, months: string[] }} args
 */
export async function monthlyReportNotices({ client, months }) {
  const wanted = [...new Set((months ?? []).map((m) => String(m).slice(0, 10)))].sort();
  if (wanted.length === 0) return [];

  const rows = await client.select(
    'period_building_reports',
    `select=*&period=eq.month&period_start=in.(${wanted.join(',')})&order=period_start.asc`
  );
  const byStart = new Map((rows ?? []).map((r) => [String(r.period_start).slice(0, 10), r]));
  return wanted.flatMap((start) => (byStart.has(start) ? [reportNotice(byStart.get(start))] : []));
}
