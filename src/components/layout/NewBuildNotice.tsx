/**
 * "A newer version of this dashboard is available" — RM-043.
 *
 * OFFERED, NOT IMPOSED. The kiosk reloads itself (see `useBuildWatch`); a person over Tailscale
 * may be halfway through issuing a command, and a page that refreshed itself under their hand
 * would be a worse fault than the stale build this exists to end.
 *
 * DISMISSIBLE, AND IT STAYS DISMISSED for this tab. Somebody who has decided to finish what they
 * are doing should not be asked again five minutes later; the next reload picks the new build up
 * anyway, which is the whole point.
 */
import { useState } from 'react';
import { RefreshCw, X } from 'lucide-react';
import { useBuildWatch } from '@/hooks/useBuildWatch';

export function NewBuildNotice() {
  const { stale } = useBuildWatch();
  const [dismissed, setDismissed] = useState(false);
  if (!stale || dismissed) return null;

  return (
    <div className="new-build" role="status">
      <RefreshCw size={14} aria-hidden="true" />
      <span className="new-build__text">
        A newer version of this dashboard has been deployed. This tab is still running the old
        one.
      </span>
      <button type="button" className="new-build__btn" onClick={() => window.location.reload()}>
        Reload
      </button>
      <button
        type="button"
        className="new-build__dismiss"
        aria-label="Dismiss until the next reload"
        onClick={() => setDismissed(true)}
      >
        <X size={14} aria-hidden="true" />
      </button>
    </div>
  );
}
