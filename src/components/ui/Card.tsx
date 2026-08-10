import type { ReactNode } from 'react';

interface CardProps {
  children: ReactNode;
  /** Optional header row. Omit both title and action for a bare surface. */
  title?: string;
  subtitle?: string;
  action?: ReactNode;
  /** Darker recessed surface — for de-emphasised or "not applicable" content. */
  inset?: boolean;
  /** Removes padding so the child can bleed to the edges (charts, tables, canvases). */
  flush?: boolean;
  className?: string;
  /**
   * Heading level for `title`, default `h3`. Every direct child of a section's `h2` (the
   * common case — Overview's KPI/energy/status cards) wants `h3`. Pass `h4` where a Card
   * sits nested one level deeper, e.g. `DevicesView`'s device cards inside an `h3` class
   * group — otherwise both levels render as sibling `h3`s and the outline can't tell a
   * group heading from the items inside it.
   */
  headingLevel?: 'h3' | 'h4';
}

/**
 * The single surface primitive every view is built on. Card styling lives in `index.css`
 * (`.card`) rather than per-component, so a change to elevation or radius is one edit
 * rather than a sweep across a dozen files.
 */
export function Card({ children, title, subtitle, action, inset, flush, className, headingLevel = 'h3' }: CardProps) {
  const classes = ['card', inset && 'card--inset', flush && 'card--flush', className].filter(Boolean).join(' ');
  const Heading = headingLevel;

  return (
    <section className={classes}>
      {(title || action) && (
        <header className="card-head">
          <div>
            {title && <Heading className="card-title">{title}</Heading>}
            {subtitle && <p className="card-sub">{subtitle}</p>}
          </div>
          {action}
        </header>
      )}
      {children}
    </section>
  );
}
