import { LayoutDashboard } from 'lucide-react';
import { InfoHint } from '@/components/ui/InfoHint';
import { useSiteUiStore } from '@/stores/siteUiStore';
import type { SiteUiPrefs } from '@/lib/siteUi';

/**
 * Which optional cards this site shows — RM-035.
 *
 * WHY THESE TWO AND NOT A GENERAL LAYOUT EDITOR. Every other card on the dashboard reports
 * something measured: a reading, a total, a device's state. These two draw a PICTURE of a
 * building, from a pack surveyed in one office — `carePlan.ts` pins this site's outlets to
 * literal coordinates, and `SITE.scene_pack` names its 3D model. At a site whose room does not
 * match, both are confidently wrong, which is exactly why RM-032 refused to fall back to the
 * plan. Until a site can draw its own (RM-036/RM-037) it needs to be able to say "not this one".
 *
 * So this is not a preference panel that will grow to cover every card. It exists for cards that
 * make a claim about a building rather than about a reading, and there are two.
 *
 * WHY IT LIVES ON THE DEVICES PAGE. Partly because that is where this deployment is already
 * configured, beside the space tree and the load-shed tiers. Mostly because a control that hides
 * a card cannot live on the card it hides — there would be no way back.
 */
export function PageCardsPanel({ onClose }: { onClose: () => void }) {
  const prefs = useSiteUiStore((s) => s.prefs);
  const setPref = useSiteUiStore((s) => s.setPref);
  const canEdit = useSiteUiStore((s) => s.canEdit);
  const saving = useSiteUiStore((s) => s.saving);
  const error = useSiteUiStore((s) => s.error);

  const rows: { key: keyof SiteUiPrefs; label: string; page: string; body: string }[] = [
    {
      key: 'controlPlanCard',
      label: 'Lighting & outlet plan',
      page: 'Control',
      body:
        'The drawn layout of lamps and sockets. Every switch on it is also in the Lighting switches and Outlets lists below it, so turning this off removes the picture and no control.',
    },
    {
      key: 'overviewSceneCard',
      label: '3D model',
      page: 'Overview',
      body: 'The rendered room. It reports no reading and drives nothing; the column closes up when it is off.',
    },
  ];

  return (
    <div className="card shed-panel">
      <div className="card-head">
        <div>
          <h3 className="card-title">
            <LayoutDashboard size={16} className="title-icon" aria-hidden="true" />
            Page cards
            <InfoHint label="Why only these two cards">
              Every other card reports something measured. These two draw a picture of a building, from a layout surveyed in one
              office — so at a site whose rooms differ they are confidently wrong. Turning one off is site-wide: it applies to the
              office screen and to every phone, because it is a decision about this deployment rather than about one browser.
            </InfoHint>
          </h3>
          <p className="card-sub">Applies to everyone, including the office kiosk.</p>
        </div>
        <button type="button" className="shed-panel__close" onClick={onClose}>
          Close
        </button>
      </div>

      {!canEdit && (
        <p className="devices-watchdog-note">
          Supabase is not configured for this deployment, so these cannot be changed here. Both cards stay visible.
        </p>
      )}
      {error && <p className="devices-watchdog-note">Could not save: {error}</p>}

      {rows.map((row) => (
        <div key={row.key} className="control-list-row">
          <div className="control-list-row__body">
            <p className="control-list-row__name">
              {row.label} <span className="control-list-row__meta">· {row.page}</span>
            </p>
            <p className="control-list-row__meta">{row.body}</p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={prefs[row.key]}
            aria-label={`${row.label} on ${row.page}`}
            className={`quick-toggle${prefs[row.key] ? ' quick-toggle--on' : ''}`}
            disabled={!canEdit || saving}
            onClick={() => setPref(row.key, !prefs[row.key])}
          >
            <span className="quick-toggle__knob" />
          </button>
        </div>
      ))}
    </div>
  );
}
