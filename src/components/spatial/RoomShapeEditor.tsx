import { useMemo } from 'react';
import { Shapes } from 'lucide-react';
import { InfoHint } from '@/components/ui/InfoHint';
import { useSpaceTreeStore } from '@/stores/spaceTreeStore';
import {
  DEFAULT_SHAPE,
  MAX_GRID,
  MIN_GRID,
  SHAPE_PRESETS,
  cellIndex,
  parseShape,
  shapeToCells,
  shapeToPath,
  type RoomShape,
} from '@/lib/roomShape';

/** What "eject to grid" starts from when a room has never been gridded. Four by three reads as a
 * room rather than a chessboard, and is a sensible ceiling layout on its own. */
const DEFAULT_COLS = 4;
const DEFAULT_ROWS = 3;

/**
 * Draws the outline of one room — RM-036.
 *
 * TWO TAPS FOR THE COMMON CASE, and a way out for the uncommon one. The presets cover the shapes
 * an office actually is; "Adjust on a grid" rasterises whichever preset is showing into cells
 * that can be switched off one at a time, which is how an odd room gets drawn without anyone
 * having to place vertices.
 *
 * EJECTING IS ONE-WAY AND SAYS SO. A rasterised L cannot become a parametric L again — offering
 * a round-trip the data cannot honour would be worse than a button that warns.
 *
 * NO DRAG ANYWHERE. Sizing is numeric fields and the grid is tap-to-toggle, matching the choice
 * `SpacePlanView` already made and documented for placement: a drag needs pointer capture,
 * behaves differently under touch, and is unreachable from a keyboard, so the accessible path
 * would have to exist anyway. A room nobody can shape from a keyboard is a regression, not a
 * nicety foregone.
 */
export function RoomShapeEditor({ nodeId, nodeName }: { nodeId: string; nodeName: string }) {
  const nodes = useSpaceTreeStore((s) => s.nodes);
  const setShape = useSpaceTreeStore((s) => s.setShape);
  const canEdit = useSpaceTreeStore((s) => s.canEdit);
  const mutating = useSpaceTreeStore((s) => s.mutating);

  const node = nodes.find((n) => n.id === nodeId);
  const shape = useMemo(() => parseShape((node?.attrs as { plan?: unknown } | undefined)?.plan), [node]);
  const path = useMemo(() => shapeToPath(shape), [shape]);

  const cols = shape.kind === 'cells' ? shape.cols : DEFAULT_COLS;
  const rows = shape.kind === 'cells' ? shape.rows : DEFAULT_ROWS;

  const commit = (next: RoomShape) => {
    if (!canEdit || mutating) return;
    void setShape(nodeId, next);
  };

  const toggleCell = (index: number) => {
    if (shape.kind !== 'cells') return;
    const on = shape.on.includes(index) ? shape.on.filter((i) => i !== index) : [...shape.on, index].sort((a, b) => a - b);
    commit({ ...shape, on });
  };

  /** Resizing the grid re-rasterises the CURRENT outline rather than reindexing the old cells.
   * Reindexing would move walls the operator drew — the same reasoning that keeps device
   * fixtures as points rather than cell indices. */
  const resize = (nextCols: number, nextRows: number) => {
    const c = Math.max(MIN_GRID, Math.min(MAX_GRID, Math.round(nextCols)));
    const r = Math.max(MIN_GRID, Math.min(MAX_GRID, Math.round(nextRows)));
    commit(shapeToCells(shape, c, r));
  };

  return (
    <div className="room-shape">
      <div className="room-shape__head">
        <h4 className="card-title">
          <Shapes size={15} className="title-icon" aria-hidden="true" />
          Shape of {nodeName}
          <InfoHint label="What the shape is for">
            The outline is a sketch, not a survey — nothing here has measured the room. It exists so that a device placed in the
            corner of an L-shaped office is drawn in that corner. Positions stay relative, so the drawing can be redone at any time
            without moving anything that has already been placed.
          </InfoHint>
        </h4>
      </div>

      {/* No "Supabase is not configured" note here on purpose. `SpacePlanView` already says it
          once for the whole plan, and repeating it on every sub-panel is the noise that trains
          people to stop reading the flag — the same argument `dispatchScope` makes for only
          marking cards in the mixed state. The controls below are disabled, which is the part
          that matters. */}
      <div className="room-shape__body">
        <svg className="room-shape__preview" viewBox="0 0 1 1" preserveAspectRatio="none" role="img" aria-label={`Outline of ${nodeName}`}>
          <path d={path} vectorEffect="non-scaling-stroke" />
          {shape.kind === 'cells' &&
            Array.from({ length: cols * rows }, (_, i) => {
              const col = i % cols;
              const row = Math.floor(i / cols);
              const on = shape.on.includes(i);
              return (
                // A <rect> per cell rather than one click handler with maths: each cell is then a
                // real focusable target, so the grid is usable from a keyboard as well as a tap.
                <rect
                  key={i}
                  className={`room-shape__cell${on ? ' room-shape__cell--on' : ''}`}
                  x={col / cols}
                  y={row / rows}
                  width={1 / cols}
                  height={1 / rows}
                  role="checkbox"
                  aria-checked={on}
                  aria-label={`Cell column ${col + 1}, row ${row + 1}`}
                  tabIndex={canEdit ? 0 : -1}
                  onClick={() => toggleCell(cellIndex(col, row, cols))}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      toggleCell(cellIndex(col, row, cols));
                    }
                  }}
                />
              );
            })}
        </svg>

        <div className="room-shape__controls">
          <div className="room-shape__presets" role="group" aria-label="Room shape">
            {SHAPE_PRESETS.map((preset) => (
              <button
                key={preset.kind}
                type="button"
                className={`devices-filter-chip${shape.kind === preset.kind ? ' devices-filter-chip--active' : ''}`}
                aria-pressed={shape.kind === preset.kind}
                disabled={!canEdit || mutating}
                onClick={() => commit(preset.make())}
              >
                {preset.label}
              </button>
            ))}
          </div>

          {shape.kind === 'l' && (
            <div className="room-shape__params">
              <label className="space-plan__field">
                Notch corner
                <select
                  className="space-plan__select"
                  value={shape.notch}
                  disabled={!canEdit || mutating}
                  onChange={(e) => commit({ ...shape, notch: e.target.value as typeof shape.notch })}
                >
                  <option value="tl">Top left</option>
                  <option value="tr">Top right</option>
                  <option value="bl">Bottom left</option>
                  <option value="br">Bottom right</option>
                </select>
              </label>
              <NumberField
                label="Notch width %"
                value={Math.round(shape.nw * 100)}
                disabled={!canEdit || mutating}
                onChange={(v) => commit({ ...shape, nw: clampFraction(v) })}
              />
              <NumberField
                label="Notch height %"
                value={Math.round(shape.nh * 100)}
                disabled={!canEdit || mutating}
                onChange={(v) => commit({ ...shape, nh: clampFraction(v) })}
              />
            </div>
          )}

          {shape.kind === 'triangle' && (
            <label className="space-plan__field">
              Points
              <select
                className="space-plan__select"
                value={shape.apex}
                disabled={!canEdit || mutating}
                onChange={(e) => commit({ ...shape, apex: e.target.value as typeof shape.apex })}
              >
                <option value="top">Up</option>
                <option value="bottom">Down</option>
                <option value="left">Left</option>
                <option value="right">Right</option>
              </select>
            </label>
          )}

          {shape.kind === 'cells' ? (
            <div className="room-shape__params">
              <NumberField label="Columns" value={cols} min={MIN_GRID} max={MAX_GRID} disabled={!canEdit || mutating} onChange={(v) => resize(v, rows)} />
              <NumberField label="Rows" value={rows} min={MIN_GRID} max={MAX_GRID} disabled={!canEdit || mutating} onChange={(v) => resize(cols, v)} />
              <button type="button" className="devices-add-btn" disabled={!canEdit || mutating} onClick={() => commit(DEFAULT_SHAPE)}>
                Back to a preset
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="devices-add-btn"
              disabled={!canEdit || mutating}
              onClick={() => commit(shapeToCells(shape, DEFAULT_COLS, DEFAULT_ROWS))}
            >
              Adjust on a grid
            </button>
          )}

          <p className="space-plan__note">
            {shape.kind === 'cells'
              ? 'Tap a cell to add or remove it. Going back to a preset starts the outline again — the cells are not kept.'
              : 'Adjusting on a grid turns this outline into squares you can switch off one at a time. It cannot be turned back into a preset afterwards.'}
          </p>
        </div>
      </div>
    </div>
  );
}

/** Percentages are stored as fractions strictly inside 0..1: a notch of 0 or 100% is not an
 * L-shape, it is a rectangle or an empty room, and `parseShape` rejects both. */
function clampFraction(percent: number): number {
  return Math.min(0.95, Math.max(0.05, Math.round(percent) / 100));
}

function NumberField({
  label,
  value,
  min = 5,
  max = 95,
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  disabled: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <label className="space-plan__field">
      {label}
      <input
        type="number"
        className="space-plan__number"
        value={value}
        min={min}
        max={max}
        disabled={disabled}
        onChange={(e) => {
          const next = Number(e.target.value);
          if (Number.isFinite(next)) onChange(next);
        }}
      />
    </label>
  );
}
