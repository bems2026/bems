/**
 * Start a room from a known layout — RM-044.
 *
 * WHAT THIS IS FOR. The CARE office's layout was a build-time pack: it rendered wherever
 * `SITE.scene_pack` named it, could not be edited, and could not be used anywhere else. The
 * knowledge in it is real — the outlet coordinates came from the live Node-RED dashboard's own
 * fixed `coords`, the ceiling grid from `LIGHT_PLAN`. Applying it here turns that into ordinary
 * data: a starting point somebody chose, which they can then move.
 *
 * IT OVERWRITES, AND IT SAYS SO. Applying a preset moves every device it names into this room
 * and replaces its position and its lamps. That is a large, mostly-irreversible edit, so it is
 * behind a confirmation that names the count rather than a button that just does it.
 *
 * IT NEVER INVENTS. Devices this deployment does not have are skipped and reported. A preset
 * naming another building's hardware applies the part that fits and says what it could not.
 */
import { useState } from 'react';
import { LayoutTemplate } from 'lucide-react';
import { PLAN_PRESETS, presetPlacements, type PlanPreset } from '@/lib/planPresets';
import { useDeviceStore } from '@/stores/deviceStore';
import { useDeviceConfigStore } from '@/stores/deviceConfigStore';
import { useSpaceTreeStore } from '@/stores/spaceTreeStore';
import { InfoHint } from '@/components/ui/InfoHint';

export function PlanPresetPicker({ nodeId, nodeName }: { nodeId: string; nodeName: string }) {
  const devices = useDeviceStore((s) => s.devices);
  const applyPlacements = useDeviceConfigStore((s) => s.applyPlacements);
  const setShape = useSpaceTreeStore((s) => s.setShape);

  const [confirming, setConfirming] = useState<PlanPreset | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  const apply = async (preset: PlanPreset) => {
    setBusy(true);
    setDone(null);
    const { placements, skipped } = presetPlacements(preset, devices.map((d) => d.id), nodeId);
    // Shape first: if the placements fail halfway, a room with an outline and some devices is a
    // more legible half-state than devices floating in a frame nobody has shaped.
    await setShape(nodeId, preset.shape);
    await applyPlacements(placements);
    setBusy(false);
    setConfirming(null);
    setDone(
      `Placed ${placements.length} device${placements.length === 1 ? '' : 's'} in ${nodeName}` +
        (skipped.length > 0 ? ` — ${skipped.length} in the preset are not on this deployment and were skipped.` : '.'),
    );
  };

  return (
    <div className="plan-preset">
      <h4 className="space-plan__subhead">
        <LayoutTemplate size={14} className="title-icon" aria-hidden="true" />
        Start from a layout
        <InfoHint label="What a layout preset does">
          A preset is a starting point, not a survey. It places the devices it names into this
          space, gives them positions and lamps, and sets the room&rsquo;s proportions — after
          which everything is ordinary data you can drag, repaint or clear. Applying one{' '}
          <strong>replaces</strong> whatever those devices currently have.
        </InfoHint>
      </h4>

      <ul className="plan-preset__list">
        {PLAN_PRESETS.map((preset) => (
          <li key={preset.id} className="plan-preset__row">
            <div className="plan-preset__text">
              <span className="plan-preset__name">{preset.label}</span>
              <span className="plan-preset__blurb">{preset.blurb}</span>
            </div>
            <button
              type="button"
              className="space-plan__btn space-plan__btn--small"
              disabled={busy}
              onClick={() => setConfirming(preset)}
            >
              Apply
            </button>
          </li>
        ))}
      </ul>

      {confirming && (
        <div className="plan-preset__confirm" role="alertdialog" aria-label="Confirm applying a layout">
          <p className="plan-preset__warn">
            {(() => {
              const { placements, skipped } = presetPlacements(confirming, devices.map((d) => d.id), nodeId);
              return (
                <>
                  This moves <strong>{placements.length}</strong> device
                  {placements.length === 1 ? '' : 's'} into {nodeName} and replaces their positions
                  and lamps.
                  {skipped.length > 0 && ` ${skipped.length} device${skipped.length === 1 ? '' : 's'} named by this layout are not on this deployment and will be skipped.`}
                </>
              );
            })()}
          </p>
          <div className="plan-preset__actions">
            <button type="button" className="space-plan__btn" disabled={busy} onClick={() => void apply(confirming)}>
              {busy ? 'Applying…' : 'Apply layout'}
            </button>
            <button type="button" className="space-plan__btn" disabled={busy} onClick={() => setConfirming(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {done && (
        <p className="plan-preset__done" role="status">
          {done}
        </p>
      )}
    </div>
  );
}
