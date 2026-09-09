import { useRef, type KeyboardEvent, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

/**
 * A real tablist — the first one in this app.
 *
 * There were two near-misses before it. `TopNav`'s `.nav-tab`s are deliberately LINKS and
 * deliberately not `role="tab"` (see its own comment): they navigate between pages, and calling
 * them tabs would promise a screen-reader user that the panel is right there. `DeviceCard`'s
 * channel switcher is a real `role="tablist"` but inlined, with no keyboard handling at all —
 * so arrow keys do nothing and every tab is a separate Tab stop. This component is what that
 * one should have been, and is a candidate to replace it later.
 *
 * TWO THINGS THE INLINE VERSIONS GET WRONG AND THIS DOES NOT.
 *
 * Roving tabindex: only the selected tab is in the tab order. Without it a five-tab strip costs
 * a keyboard user five Tab presses to walk past, and the Tab key stops meaning "next region".
 *
 * Arrow keys with wrap, plus Home/End. This is the whole reason `role="tab"` exists rather than
 * a row of buttons — the role is a promise about the keyboard, and making the promise without
 * keeping it is worse than not making it.
 *
 * ACTIVATION IS AUTOMATIC (selection follows focus), which WAI-ARIA prefers when panels are
 * cheap to show. Ours are: every panel's data is loaded by app-level stores that are already
 * mounted, so switching tabs re-renders but never re-fetches. The caller is responsible for
 * keeping that true — a panel that starts a fetch on mount should be lazy inside the panel, not
 * a reason to move to manual activation and lose the simpler keyboard model.
 */

export interface TabDef {
  id: string;
  label: string;
  icon?: LucideIcon;
  /** Rendered after the label — a count, a status dot. Kept out of the accessible name. */
  badge?: ReactNode;
}

export interface TabsProps {
  tabs: TabDef[];
  activeId: string;
  onChange: (id: string) => void;
  /** Names the tablist for assistive tech. Required: an unnamed tablist is an unnamed region. */
  label: string;
  className?: string;
}

/**
 * The DOM ids that wire a tab to its panel, in both directions. Module-private: they are an
 * implementation detail of the pairing, and exporting them trips the fast-refresh rule for no
 * caller's benefit.
 */
const tabButtonId = (id: string) => `tab-${id}`;
const tabPanelId = (id: string) => `tabpanel-${id}`;

export function Tabs({ tabs, activeId, onChange, label, className }: TabsProps) {
  const listRef = useRef<HTMLDivElement>(null);

  /** Move selection AND focus together — with automatic activation they are the same act. */
  const focusTab = (index: number) => {
    const next = tabs[index];
    if (!next) return;
    onChange(next.id);
    // The button may not exist yet on the very first render; querying the live DOM rather than
    // holding seven refs keeps this component's surface to the two props that matter.
    listRef.current?.querySelector<HTMLButtonElement>(`#${CSS.escape(tabButtonId(next.id))}`)?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const current = tabs.findIndex((t) => t.id === activeId);
    if (current < 0) return;
    const last = tabs.length - 1;
    switch (e.key) {
      case 'ArrowRight':
        focusTab(current === last ? 0 : current + 1);
        break;
      case 'ArrowLeft':
        focusTab(current === 0 ? last : current - 1);
        break;
      case 'Home':
        focusTab(0);
        break;
      case 'End':
        focusTab(last);
        break;
      default:
        return;
    }
    // Only for the keys handled above — an unconditional preventDefault here would swallow
    // Tab, and trap the keyboard user inside the tablist.
    e.preventDefault();
  };

  return (
    <div ref={listRef} role="tablist" aria-label={label} className={`tabs${className ? ` ${className}` : ''}`} onKeyDown={onKeyDown}>
      {tabs.map((t) => {
        const selected = t.id === activeId;
        const Icon = t.icon;
        return (
          <button
            key={t.id}
            id={tabButtonId(t.id)}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={tabPanelId(t.id)}
            tabIndex={selected ? 0 : -1}
            className={`tabs__tab${selected ? ' tabs__tab--active' : ''}`}
            onClick={() => onChange(t.id)}
          >
            {Icon && <Icon size={14} className="tabs__icon" aria-hidden="true" />}
            <span>{t.label}</span>
            {t.badge !== undefined && t.badge !== null && <span className="tabs__badge">{t.badge}</span>}
          </button>
        );
      })}
    </div>
  );
}

/**
 * The panel half. `tabIndex={0}` because a panel whose content has no focusable element must
 * still be reachable by keyboard — otherwise Tab from the selected tab skips the thing the tab
 * just revealed.
 */
export function TabPanel({ tabId, activeId, children }: { tabId: string; activeId: string; children: ReactNode }) {
  if (tabId !== activeId) return null;
  return (
    <div id={tabPanelId(tabId)} role="tabpanel" aria-labelledby={tabButtonId(tabId)} tabIndex={0} className="tabs__panel">
      {children}
    </div>
  );
}
