/**
 * What a report does not say, rendered from `shared/reportProse.mjs`.
 *
 * Not collapsible, and not behind a hint. RM-062's lesson on the Automation page was that a
 * warning you have to open is a footnote: the sentence that matters has to be on the page. These
 * are the limits of every figure above them, and the floor-area one in particular exists because
 * a kWh/m² computed from an assumed area would be the most quotable number in the document and
 * the least true.
 */

export interface Caveat {
  lead: string;
  body: string;
}

export function ReportCaveats({ title, items }: { title: string; items: readonly Caveat[] }) {
  return (
    <section className="report-caveats" aria-label={title}>
      <h2 className="card-title">{title}</h2>
      <ul className="report-caveats__list">
        {items.map((c) => (
          <li key={c.lead}>
            <strong>{c.lead}</strong> {c.body}
          </li>
        ))}
      </ul>
    </section>
  );
}
