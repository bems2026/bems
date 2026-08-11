import type { ReactNode } from 'react';
import { TopNav } from './TopNav';

interface AppShellProps {
  activeId: string;
  children: ReactNode;
}

/**
 * Phase M shell: sticky top nav + one routed page. Replaces Phase L's collapsible-sidebar
 * `AppShell` — collapse state, the off-canvas drawer, and the scroll-spy `useEffect` are
 * all gone because there's no sidebar and no multi-section scroll to spy on anymore;
 * `App.tsx` now decides which single page component to pass as `children` based on
 * `useHashRoute`, and this component just provides the chrome around it.
 */
export function AppShell({ activeId, children }: AppShellProps) {
  return (
    <div className="app-shell">
      {/* First focusable element on the page, invisible until it receives keyboard focus
          (see .skip-link in index.css) — lets a keyboard user bypass the nav entirely. */}
      <a href="#main-content" className="skip-link">
        Skip to main content
      </a>
      <TopNav activeId={activeId} />
      <div className="app-main">
        {/* id targeted by the skip link above. tabIndex=-1 lets it receive programmatic
            focus on skip-link activation without adding it to the normal tab order. */}
        <main id="main-content" className="app-content" tabIndex={-1}>
          {children}
        </main>
      </div>
    </div>
  );
}
