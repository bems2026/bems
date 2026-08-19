import type { ReactNode } from 'react';

interface PageHeaderProps {
  title: ReactNode;
  sub?: ReactNode;
  actions?: ReactNode;
}

/**
 * Phase Q: the shared `<header className="page-header">` shell every page used to hand-roll
 * separately — Overview, Analytics, Control, Devices, and Automation each declared their own
 * copy, and the copies had already drifted: an `align-items: flex-end` header bottom-aligns
 * blocks of different heights, so each page's actions row landed a different distance from
 * its title (measured 9.6-24.1px apart across the five pages — see index.css's `.page-header`
 * comment for the numbers). One component, styled once in index.css, makes that impossible to
 * repeat: alignment is a property of `PageHeader` now, not of five call sites remembering to
 * agree with each other.
 *
 * `sub` and `actions` are `ReactNode`, not `string` — Analytics, Control, and Automation all
 * embed an `<InfoHint>` inside their sub-line, and Overview's `actions` is a live clock, not a
 * button row, so both slots need to accept arbitrary markup.
 */
export function PageHeader({ title, sub, actions }: PageHeaderProps) {
  return (
    <header className="page-header">
      <div className="page-header__lead">
        <h1 className="page-title">{title}</h1>
        {sub ? <p className="page-sub">{sub}</p> : null}
      </div>
      {actions ? <div className="page-header__actions">{actions}</div> : null}
    </header>
  );
}
