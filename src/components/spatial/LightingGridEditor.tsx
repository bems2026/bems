/**
 * Which lamps a lighting circuit reaches — RM-037.
 *
 * WHAT THIS REPLACES. `src/components/control/plans/carePlan.ts` hands every circuit exactly
 * three ceiling cells at coordinates surveyed in one office. Any other room is drawn wrongly
 * while looking entirely correct — the failure RM-032 refused to accept — and it is simply wrong
 * for a circuit that does not have three fixtures.
 *
 * THE CONTROLS ARE HERE; THE PAINTING HAPPENS ON THE PLAN ITSELF. This component owns no canvas.
 * Its state is lifted into `SpacePlanView`, which draws the grid inside the room's own outline,
 * beside the other devices, because that is the only place a ceiling layout can be checked
 * against anything. A second square below the plan would be a drawing of a drawing.
 *
 * THE GRID IS AN INPUT METHOD, NOT A STORAGE FORMAT — see `src/lib/lightingGrid.ts`. Changing
 * the columns here moves nothing that is already painted, and the test that proves it is the
 * most load-bearing one in this feature.
 *
 * COLOUR IS AN AID, NOT THE LABEL. Every circuit is named as well as coloured: a plan read by
 * somebody who cannot separate two hues must still say which switch reaches which lamp.
 */
import { Lightbulb } from 'lucide-react';
import { MIN_GRID, MAX_GRID } from '@/lib/roomShape';
import { InfoHint } from '@/components/ui/InfoHint';
import type { Device } from '@/lib/types';

export interface LampGrid {
  cols: number;
  rows: number;
}

export function LightingGridEditor({
  circuits,
  nameOf,
  colors,
  counts,
  painting,
  onPaint,
  grid,
  onGrid,
}: {
  circuits: Device[];
  nameOf: (id: string) => string;
  colors: Record<string, string>;
  counts: Record<string, number>;
  painting: string | null;
  onPaint: (id: string | null) => void;
  grid: LampGrid;
  onGrid: (grid: LampGrid) => void;
}) {
  if (circuits.length === 0) {
    // An editor whose only control does nothing is worse than a sentence saying why.
    return (
      <p className="space-plan__note">
        No lighting circuits are in this space yet. Place a light switch into it, then its lamps
        can be drawn here.
      </p>
    );
  }

  const setAxis = (axis: keyof LampGrid, raw: string) => {
    const value = Number(raw);
    if (!Number.isInteger(value) || value < MIN_GRID || value > MAX_GRID) return;
    onGrid({ ...grid, [axis]: value });
  };

  return (
    <div className="lamp-editor">
      <h4 className="space-plan__subhead">
        <Lightbulb size={14} className="title-icon" aria-hidden="true" />
        Lamps
        <InfoHint label="How lamps are drawn">
          Pick a circuit, then tap the ceiling grid on the plan — once to add a lamp, again to
          take it away. The grid is only a way to aim: what gets saved is <strong>where each lamp
          is</strong>, so changing the columns later re-aims the grid without moving anything you
          have already drawn.
        </InfoHint>
      </h4>

      <ul className="lamp-editor__list">
        {circuits.map((circuit) => {
          const active = painting === circuit.id;
          return (
            <li key={circuit.id} className="lamp-editor__row">
              <span className="lamp-editor__swatch" style={{ background: colors[circuit.id] }} aria-hidden="true" />
              <span className="lamp-editor__name">{nameOf(circuit.id)}</span>
              <span className="lamp-editor__count" data-testid={`lamp-count-${circuit.id}`}>
                {counts[circuit.id] ?? 0}
                <span className="lamp-editor__count-unit"> lamp{(counts[circuit.id] ?? 0) === 1 ? '' : 's'}</span>
              </span>
              <button
                type="button"
                className={`space-plan__btn space-plan__btn--small${active ? ' space-plan__btn--on' : ''}`}
                aria-pressed={active}
                // Named rather than "Paint": two buttons reading "Paint" in a room with two
                // circuits are indistinguishable to anything that reads labels aloud.
                aria-label={active ? `Stop painting lamps for ${nameOf(circuit.id)}` : `Paint lamps for ${nameOf(circuit.id)}`}
                onClick={() => onPaint(active ? null : circuit.id)}
              >
                {active ? 'Done' : 'Paint'}
              </button>
            </li>
          );
        })}
      </ul>

      {painting !== null && (
        <div className="lamp-editor__grid-size">
          <span className="lamp-editor__hint">Tap the plan to add or remove a lamp.</span>
          <label className="space-plan__axis" htmlFor="lamp-grid-cols">
            Columns
          </label>
          <input
            id="lamp-grid-cols"
            className="space-plan__axis-input"
            type="number"
            min={MIN_GRID}
            max={MAX_GRID}
            step={1}
            value={grid.cols}
            onChange={(e) => setAxis('cols', e.target.value)}
          />
          <label className="space-plan__axis" htmlFor="lamp-grid-rows">
            Rows
          </label>
          <input
            id="lamp-grid-rows"
            className="space-plan__axis-input"
            type="number"
            min={MIN_GRID}
            max={MAX_GRID}
            step={1}
            value={grid.rows}
            onChange={(e) => setAxis('rows', e.target.value)}
          />
        </div>
      )}
    </div>
  );
}
