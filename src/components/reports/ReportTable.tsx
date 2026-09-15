import type { ReactNode } from 'react';

/**
 * The report's tables — RM-082.
 *
 * They used to borrow `.devices-table` from the fleet grid, and three things came with it that a
 * table of figures cannot afford: a `min-width: 860px` sized for eight columns, which made a
 * five-column report scroll on the kiosk; units repeated in every cell; and an `is-numeric` class
 * with no CSS rule behind it, so every number was left-aligned — the one alignment a column of
 * figures cannot be scanned in.
 *
 * WHAT THIS DOES INSTEAD. Units live in the header, once. Numeric columns are right-aligned with
 * tabular numerals, header and cells alike, so decimal places line up down the column. Rows are
 * separated by a hairline and nothing else — no zebra striping, no vertical rules — because the
 * alignment already does the work those would do. The first column is each row's header, so a
 * screen reader can say which device a figure belongs to.
 *
 * A MISSING VALUE IS AN EM DASH AND A ZERO IS A ZERO. `null`, `undefined` and the empty string are
 * missing; `0` and `'0'` are measurements. Collapsing the two in either direction is the error this
 * page exists to avoid.
 */

export interface ReportColumn<Row> {
  id: string;
  header: string;
  /** Said once, in the header: "Energy (kWh)". */
  unit?: string;
  numeric?: boolean;
  cell: (row: Row) => ReactNode;
}

interface Props<Row> {
  /** The first column is each row's header. */
  columns: readonly ReportColumn<Row>[];
  rows: readonly Row[];
  rowKey: (row: Row, index: number) => string;
  /** The table's accessible name. */
  label: string;
  caption?: string;
}

const isMissing = (value: ReactNode) => value === null || value === undefined || value === '';

export function ReportTable<Row>({ columns, rows, rowKey, label, caption }: Props<Row>) {
  return (
    <div className="report-table-scroll">
      <table className="report-table" aria-label={label}>
        {caption ? <caption className="report-table__caption">{caption}</caption> : null}
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.id} scope="col" className={column.numeric ? 'report-table__num' : undefined}>
                {column.header}
                {column.unit ? ` (${column.unit})` : null}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={rowKey(row, index)}>
              {columns.map((column, columnIndex) => {
                const value = column.cell(row);
                const content = isMissing(value) ? <span className="reports-figure reports-figure--missing">—</span> : value;
                return columnIndex === 0 ? (
                  <th key={column.id} scope="row">
                    {content}
                  </th>
                ) : (
                  <td key={column.id} className={column.numeric ? 'report-table__num' : undefined}>
                    {content}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
