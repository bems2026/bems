import { useState } from 'react';
import { Building2, LayoutDashboard, Map as MapIcon, Server, UserRound } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { SpaceTreePanel } from '@/components/devices/SpaceTreePanel';
import { SpacePlanPanel } from '@/components/spatial/SpacePlanPanel';
import { PageCardsPanel } from '@/components/devices/PageCardsPanel';
import { AccountSection } from './AccountSection';
import { DeploymentSection } from './DeploymentSection';

/**
 * Where this deployment is configured — one page, replacing four buttons on the Devices toolbar.
 *
 * WHY IT EXISTS. The Devices header had grown to five buttons plus six filter chips, needing
 * **1123px on one line** (measured 2026-09-01), so it wrapped to two rows on any laptop. Four of
 * those five buttons — Spaces, Floor plan, Load shedding, Page cards — were configuration that
 * had nothing to do with the device list beneath them; they were there because the Devices page
 * was the only page with a toolbar. Load shedding went to Automation, where the thing that acts
 * on it already lives. The rest came here.
 *
 * LIST AND DETAIL, NOT A LONG PAGE. Two of these sections are tall editors — the space tree and
 * the floor plan. Stacked, reaching the deployment facts at the bottom would mean scrolling past
 * a whole plan editor. On a phone the list IS the page and choosing a section replaces it, with
 * a way back; that is the pattern every settings screen on the device already uses.
 *
 * THE SECTION IS LOCAL STATE, NOT A ROUTE. `useHashRoute` matches a hash against a flat list of
 * page ids, so `#settings/spaces` would need the router to learn about sub-paths — a change to
 * the one piece of navigation every page depends on, to buy a deep link into a settings pane.
 * Worth doing if anyone ever wants to link to one; not worth doing first.
 */
type SectionId = 'account' | 'spaces' | 'floorplan' | 'display' | 'deployment';

const SECTIONS: { id: SectionId; label: string; blurb: string; Icon: typeof UserRound }[] = [
  { id: 'account', label: 'Account', blurb: 'Who is signed in, and how', Icon: UserRound },
  { id: 'spaces', label: 'Spaces', blurb: 'Buildings, floors and rooms', Icon: Building2 },
  { id: 'floorplan', label: 'Floor plan', blurb: 'Room outlines and where devices sit', Icon: MapIcon },
  { id: 'display', label: 'Page cards', blurb: 'Which optional cards this site shows', Icon: LayoutDashboard },
  { id: 'deployment', label: 'Deployment', blurb: 'What this installation is set to', Icon: Server },
];

export function SettingsPage() {
  const [section, setSection] = useState<SectionId | null>(null);
  const current = SECTIONS.find((s) => s.id === section) ?? null;

  return (
    <>
      <PageHeader
        title="Settings"
        sub={current ? current.label : 'How this deployment is set up'}
        actions={
          current && (
            <div className="page-actions">
              {/* Only rendered once a section is open. On a wide screen the list is still
                  visible beside it, so this is the phone's way back — but it costs nothing on
                  desktop and having two ways back is better than a dead end on a narrow one. */}
              <button type="button" className="devices-add-btn" onClick={() => setSection(null)}>
                ← All settings
              </button>
            </div>
          )
        }
      />

      <div className={`settings${current ? ' settings--open' : ''}`}>
        <nav className="settings__list" aria-label="Settings sections">
          {SECTIONS.map(({ id, label, blurb, Icon }) => (
            <button
              key={id}
              type="button"
              className={`settings__item${section === id ? ' settings__item--active' : ''}`}
              aria-current={section === id ? 'page' : undefined}
              onClick={() => setSection(id)}
            >
              <Icon size={16} className="settings__icon" aria-hidden="true" />
              <span className="settings__item-body">
                <span className="settings__item-label">{label}</span>
                <span className="settings__item-blurb">{blurb}</span>
              </span>
            </button>
          ))}
        </nav>

        <div className="settings__detail">
          {section === null && (
            <p className="space-plan__note">
              Choose a section. Nothing here changes what the building is doing — these are settings for how it is described and
              displayed. The controls that switch real hardware are on Control and Automation.
            </p>
          )}
          {section === 'account' && <AccountSection />}
          {/* No `onClose` on any of these: they are sections of this page, not panels floating
              over another one. The prop is optional precisely so the same component can be both. */}
          {section === 'spaces' && <SpaceTreePanel />}
          {section === 'floorplan' && <SpacePlanPanel />}
          {section === 'display' && <PageCardsPanel />}
          {section === 'deployment' && <DeploymentSection />}
        </div>
      </div>
    </>
  );
}
