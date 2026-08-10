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
}

/**
 * The single surface primitive every view is built on. Card styling lives in `index.css`
 * (`.card`) rather than per-component, so a change to elevation or radius is one edit
 * rather than a sweep across a dozen files.
 */
export function Card({ children, title, subtitle, action, inset, flush, className }: CardProps) {
  const classes = ['card', inset && 'card--inset', flush && 'card--flush', className].filter(Boolean).join(' ');

  return (
    <section className={classes}>
      {(title || action) && (
        <header className="card-head">
          <div>
            {title && <h3 className="card-title">{title}</h3>}
            {subtitle && <p className="card-sub">{subtitle}</p>}
          </div>
          {action}
        </header>
      )}
      {children}
    </section>
  );
}
