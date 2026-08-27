/**
 * The editable plan, as a Devices-page panel — RM-031.
 *
 * A shell, deliberately thin: `SpacePlanView` is the whole feature and this adds only the panel
 * chrome. Same shape `SpaceTreePanel` and `DeviceMetaEditor` already use — conditionally
 * rendered, focus moves to its own heading, `onClose` is the caller's business.
 *
 * WHY EDITING LIVES HERE AND NOT ON OVERVIEW. The same plan renders in both places, read-only on
 * Overview as the site's spatial hero and editable here. Positioning a device is configuration,
 * and configuration belongs beside the tree that the positions are relative to.
 */
import { useEffect, useRef } from 'react';
import { Card } from '@/components/ui/Card';
import { SpacePlanView } from './SpacePlanView';

export function SpacePlanPanel({ onClose }: { onClose: () => void }) {
  const headingRef = useRef<HTMLHeadingElement>(null);

  // Same focus treatment the other panels use: the heading takes focus on open so a screen
  // reader lands here, without trapping — Tab still reaches the rest of the page, on purpose.
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <Card className="space-plan-panel">
      <div className="space-plan-panel__head">
        <h2 className="card-title" ref={headingRef} tabIndex={-1}>
          Floor plan
        </h2>
        <button type="button" className="space-plan-panel__close" onClick={onClose}>
          Close
        </button>
      </div>
      <p className="space-plan-panel__lede">
        Each space has its own plan. Choose a space, pick a device, then click where it sits —
        or select a pin and type its position. A device is drawn only on the plan of the space it
        is placed in, because that is what its position was measured against.
      </p>
      <SpacePlanView editable />
    </Card>
  );
}
