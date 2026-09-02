/**
 * The floor plan, drawn from data — RM-031.
 *
 * WHAT THIS REPLACES. `components/scene3d/FloorPlanView.tsx` is a fine plan of one office and
 * is unusable anywhere else: it pins `co1`..`co7` to literal SVG coordinates surveyed in that
 * room. RM-032 refused to fall back to it for a site with no 3D pack, because at another site it
 * would draw that site's devices at this site's positions and look entirely correct doing it.
 * Nothing in this file names a device, a room, or a coordinate.
 *
 * A ROOM'S PLAN DRAWS THE DEVICES IN THAT ROOM AND NO OTHERS. Coordinates are normalised against
 * one node (see `planLayout.ts`), so a device in a child room carries a position measured against
 * the child's frame. Drawing it in the parent's frame would place it somewhere nobody chose —
 * and the result would look surveyed. Descendants are counted and named, not drawn.
 *
 * THE FRAME IS NORMALISED SPACE, NOT A SURVEY. Positions are 0..1 and always were; what changed
 * in RM-044 is that a room may now carry its own PROPORTIONS in `attrs.plan.aspect`, so the
 * drawing is shaped like the room instead of always square. A room that has not said stays
 * square — and square still means "nobody has said", never "measured as square". The positions
 * are unaffected either way: three quarters of the way down is three quarters of the way down,
 * whatever the frame's shape.
 *
 * PLACEMENT IS CLICK-TO-PLACE, NOT DRAG. The roadmap said drag; this is a deliberate deviation
 * and the reason is the kiosk. A drag needs pointer capture, behaves differently under touch, and
 * is unreachable from a keyboard, so building it would have meant building this path anyway as
 * the accessible one. Arm a device, click where it goes; or select a pin and type its position.
 * One mechanism covers placing, moving and precise adjustment, on every input device.
 *
 * A DROP SAVES IMMEDIATELY (`placeOnPlan`). A plan still showing a pin where it was released,
 * while the change sits behind a Save button, is displaying a position the database does not
 * have.
 */
import { useMemo, useState } from 'react';
import { Map as MapIcon } from 'lucide-react';
import { useDeviceStore } from '@/stores/deviceStore';
import { useDeviceConfigStore } from '@/stores/deviceConfigStore';
import { useSpaceTreeStore } from '@/stores/spaceTreeStore';
import { flattenForPicker, pathLabel, subtreeIds } from '@/lib/spaceTree';
import { groupByPlacement, planPointOf, pointerToPlan, clampToPlan, type PlanPoint } from '@/lib/planLayout';
import { parseShape, shapeToPath, containsPoint, parseAspect } from '@/lib/roomShape';
import { gridCells, circuitColors } from '@/lib/lightingGrid';
import { RoomShapeEditor } from './RoomShapeEditor';
import { LightingGridEditor, type LampGrid } from './LightingGridEditor';
import { PlanPresetPicker } from './PlanPresetPicker';
import { resolveDisplayName } from '@/lib/deviceConfig';
import { isReadingStale } from '@/lib/staleness';
import { InfoHint } from '@/components/ui/InfoHint';
import type { Device } from '@/lib/types';

/** Where an unpositioned device lands when it is placed from the keyboard rather than by
 * pointing. The middle is not a survey and is not offered as one — it is behind a button that
 * says so, after which the two number fields refine it. */
const KEYBOARD_START: PlanPoint = { x: 0.5, y: 0.5 };

/** The ceiling grid a room starts with. Twelve cells is a plausible small office and, more to the
 * point, it is only an aiming aid — see `lightingGrid.ts`. Nothing stored depends on it, so the
 * default costs nothing if it is wrong. */
const DEFAULT_LAMP_GRID: LampGrid = { cols: 4, rows: 3 };

export function SpacePlanView({ editable = false }: { editable?: boolean }) {
  const devices = useDeviceStore((s) => s.devices);
  const readings = useDeviceStore((s) => s.latestReadings);
  const saved = useDeviceConfigStore((s) => s.saved);
  const placeOnPlan = useDeviceConfigStore((s) => s.placeOnPlan);
  const toggleFixtureAt = useDeviceConfigStore((s) => s.toggleFixtureAt);
  const saveError = useDeviceConfigStore((s) => s.saveError);
  const nodes = useSpaceTreeStore((s) => s.nodes);
  const configured = useSpaceTreeStore((s) => s.canEdit);

  const [nodeId, setNodeId] = useState('');
  // The selected room's own outline (RM-036), or the full frame for a room nobody has drawn —
  // which is exactly what every plan looked like before shapes existed, so an undrawn room is
  // unchanged rather than empty.
  const shape = useMemo(() => {
    const node = nodes.find((n) => n.id === nodeId);
    return parseShape((node?.attrs as { plan?: unknown } | undefined)?.plan);
  }, [nodes, nodeId]);
  const shapePath = useMemo(() => shapeToPath(shape), [shape]);
  /** The room's proportions, or null for the square frame every plan had before RM-044. Square
   * means "nobody has said", not "measured as square". */
  const aspect = useMemo(() => {
    const node = nodes.find((n) => n.id === nodeId);
    return parseAspect((node?.attrs as { plan?: unknown } | undefined)?.plan);
  }, [nodes, nodeId]);
  /** The device currently being positioned — armed from the tray, or selected by clicking its
   * pin. One piece of state for both, because they are the same act at different stages. */
  const [armed, setArmed] = useState<string | null>(null);
  /** The lighting circuit whose lamps are being painted, and the grid being aimed with. Both live
   * here rather than in `LightingGridEditor` because the grid is drawn on this frame — one piece
   * of state, or the overlay and the controls would disagree about the room. */
  const [painting, setPainting] = useState<string | null>(null);
  const [lampGrid, setLampGrid] = useState<LampGrid>(DEFAULT_LAMP_GRID);

  const canPlace = editable && configured;
  const options = useMemo(() => flattenForPicker(nodes), [nodes]);

  const placed = useMemo(
    () => devices.map((d) => ({ id: d.id, nodeId: saved[d.id]?.spaceNodeId ?? null })),
    [devices, saved],
  );
  const groups = useMemo(() => groupByPlacement(placed, nodes), [placed, nodes]);

  const byId = useMemo(() => new Map(devices.map((d) => [d.id, d])), [devices]);
  const nameOf = (id: string) => {
    const device = byId.get(id);
    return device ? resolveDisplayName(device, saved[id]) : id;
  };

  // Devices in THIS node, split by whether anyone has said where in it they are. Descendants are
  // deliberately excluded — see the header.
  const here = useMemo(() => devices.filter((d) => saved[d.id]?.spaceNodeId === nodeId), [devices, saved, nodeId]);
  const positioned = here.filter((d) => planPointOf(saved[d.id]) !== null);
  const unpositioned = here.filter((d) => planPointOf(saved[d.id]) === null);

  // The lighting layer — RM-037. A circuit does not need a pin of its own to have lamps: the
  // switch is on a wall and its luminaires are on the ceiling, which is why these are separate
  // columns rather than one.
  const circuits = here.filter((d) => d.class === 'switch');
  const colors = useMemo(() => circuitColors(circuits.map((d) => d.id)), [circuits]);
  const lampCounts = useMemo(
    () => Object.fromEntries(circuits.map((d) => [d.id, saved[d.id]?.planFixtures?.length ?? 0])),
    [circuits, saved],
  );
  const cells = useMemo(() => gridCells(lampGrid.cols, lampGrid.rows), [lampGrid]);

  // A soft warning, never a block. The outline is the operator's sketch; refusing a placement
  // because a hand-drawn wall is slightly off would make the drawing authoritative over the
  // building. Lamps count too — a ceiling painted past a wall is the same mistake.
  const strays = here.reduce((n, d) => {
    const cfg = saved[d.id];
    const point = planPointOf(cfg);
    const outside = (p: PlanPoint) => !containsPoint(shape, p.x, p.y);
    const pinOut = point !== null && outside(point) ? 1 : 0;
    return n + pinOut + (cfg?.planFixtures ?? []).filter(outside).length;
  }, 0);

  const deeper = useMemo(() => {
    if (nodeId === '') return 0;
    const inside = subtreeIds(nodes, nodeId);
    return devices.filter((d) => {
      const at = saved[d.id]?.spaceNodeId;
      return at !== undefined && at !== null && at !== nodeId && inside.has(at);
    }).length;
  }, [devices, saved, nodes, nodeId]);

  if (nodes.length === 0) {
    return (
      <div className="space-plan">
        <p className="space-plan__note">
          No spaces defined yet. Add them in Settings, under Spaces, then place devices into
          them — this plan draws whatever is placed.
        </p>
      </div>
    );
  }

  const onFrameClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!canPlace || armed === null) return;
    const point = pointerToPlan({ x: event.clientX, y: event.clientY }, event.currentTarget.getBoundingClientRect());
    // Null means the frame has no size — hidden, or not laid out yet. Doing nothing is the only
    // honest answer: `0/0` is NaN, which the database would reject after the pin appeared to move.
    if (point === null) return;
    void placeOnPlan(armed, point);
  };

  const armedPoint = armed === null ? null : planPointOf(saved[armed]);

  const setAxis = (axis: 'x' | 'y', percent: string) => {
    if (armed === null || armedPoint === null) return;
    const value = Number(percent);
    if (!Number.isFinite(value)) return;
    void placeOnPlan(armed, clampToPlan({ ...armedPoint, [axis]: value / 100 }));
  };

  return (
    <div className="space-plan">
      <div className="space-plan__head">
        <h3 className="card-title">
          <MapIcon size={16} className="title-icon" aria-hidden="true" />
          Floor plan
          <InfoHint label="What this plan shows">
            Each space has its own plan, and a device is drawn on the plan of the space it is
            placed in — never on the plan of a space above it, because its position was set
            against its own room. The frame is <strong>relative</strong>: a device three quarters
            of the way down is drawn three quarters of the way down, whatever the real room
            measures.
          </InfoHint>
        </h3>
        <label className="space-plan__field" htmlFor="space-plan-node">
          Space
        </label>
        <select
          id="space-plan-node"
          className="space-plan__select"
          value={nodeId}
          onChange={(e) => {
            setNodeId(e.target.value);
            // A device armed in one room means nothing in another, and neither does a circuit
            // whose lamps were being painted.
            setArmed(null);
            setPainting(null);
          }}
        >
          <option value="">All spaces</option>
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.path}
            </option>
          ))}
        </select>
      </div>

      {editable && !configured && (
        <p className="space-plan__note">
          Supabase is not configured for this deployment, so positions cannot be edited here.
        </p>
      )}

      {saveError && (
        <p className="space-plan__error" role="alert">
          {saveError}
        </p>
      )}

      {nodeId === '' ? (
        <PlacementIndex groups={groups} nameOf={nameOf} readings={readings} onOpen={setNodeId} />
      ) : (
        <>
          <div
            className={`space-plan__frame${painting !== null && canPlace ? ' space-plan__frame--painting' : ''}`}
            style={aspect === null ? undefined : { aspectRatio: String(aspect) }}
            data-testid="plan-frame"
            onClick={onFrameClick}
            aria-label={`Plan of ${pathLabel(nodes, nodeId)}`}
          >
            {/* The room's own outline — RM-036. Drawn UNDER the pins and deliberately not
                clipping them: the shape is the operator's sketch, not a survey, so a device
                falling outside it is a warning worth seeing rather than a device to hide.
                `pointer-events: none` so every click still reaches the frame's placement
                handler; the outline is a drawing, not a target. */}
            <svg className="space-plan__shape" viewBox="0 0 1 1" preserveAspectRatio="none" aria-hidden="true">
              <path d={shapePath} vectorEffect="non-scaling-stroke" />
            </svg>
            {/* The ceiling grid, only while a circuit is being painted — RM-037. Above the
                outline so it can be aimed against the room, below the pins so a device is never
                hidden by the thing being drawn around it. */}
            {painting !== null && canPlace && (
              <div
                className="space-plan__lamp-grid"
                data-testid="lamp-grid"
                style={{ gridTemplateColumns: `repeat(${lampGrid.cols}, 1fr)`, gridTemplateRows: `repeat(${lampGrid.rows}, 1fr)` }}
              >
                {cells.map((cell, i) => (
                  <button
                    key={i}
                    type="button"
                    className="space-plan__cell"
                    // Coordinates a person can act on: "column 2, row 1" is somewhere to look on
                    // a ceiling; cell 1 of 12 is not.
                    aria-label={`Column ${(i % lampGrid.cols) + 1}, row ${Math.floor(i / lampGrid.cols) + 1}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      void toggleFixtureAt(painting, cell, lampGrid.cols, lampGrid.rows);
                    }}
                  />
                ))}
              </div>
            )}
            {/* Lamps, drawn wherever the plan is — they are the lighting layout, not an editing
                affordance, and a read-only plan that omitted them would be showing a different
                room from the one the editor shows. */}
            {circuits.flatMap((circuit) =>
              (saved[circuit.id]?.planFixtures ?? []).map((lamp, i) => (
                <span
                  key={`${circuit.id}-${i}`}
                  className={`space-plan__lamp${painting === circuit.id ? ' space-plan__lamp--painting' : ''}`}
                  data-testid={`plan-lamp-${circuit.id}-${i}`}
                  style={{ left: `${lamp.x * 100}%`, top: `${lamp.y * 100}%`, ['--lamp' as string]: colors[circuit.id] }}
                  title={`${nameOf(circuit.id)} — lamp ${i + 1}`}
                />
              )),
            )}
            {positioned.map((device) => {
              const point = planPointOf(saved[device.id]);
              if (point === null) return null;
              return (
                <Pin
                  key={device.id}
                  device={device}
                  name={nameOf(device.id)}
                  point={point}
                  stale={isReadingStale(readings[device.id])}
                  selected={armed === device.id}
                  // Not selectable while lamps are being painted. A frame click has to mean
                  // exactly one thing, and enforcing that where a device can be armed is
                  // structural — a guard in the click handler would be checking a state that
                  // could still be entered behind it. The pin stays visible; it is a marker for
                  // as long as the grid is up.
                  selectable={canPlace && painting === null}
                  onSelect={() => setArmed(device.id)}
                />
              );
            })}
            {positioned.length === 0 && Object.values(lampCounts).every((n) => n === 0) && (
              <p className="space-plan__frame-empty">
                {/* An empty frame with no explanation reads as a failed render. */}
                Nothing on this plan yet.
                {canPlace && ' Choose a device below, then click where it sits.'}
              </p>
            )}
          </div>

          {strays > 0 && (
            <p className="space-plan__note space-plan__note--warn">
              {strays === 1 ? 'One thing sits' : `${strays} things sit`} outside the drawn outline.
              That is allowed — the outline is a sketch, not a survey — but it is worth a look.
            </p>
          )}

          {/* Only where the plan is already editable. On the read-only Spatial view the outline
              is something to look at, and an editor there would offer a write the page has
              otherwise promised not to make. */}
          {editable && <RoomShapeEditor nodeId={nodeId} nodeName={pathLabel(nodes, nodeId)} />}

          {/* RM-044. Below the shape editor: a preset sets the shape too, so it reads as the
              shortcut to what is above it rather than a competing control. */}
          {canPlace && <PlanPresetPicker nodeId={nodeId} nodeName={pathLabel(nodes, nodeId)} />}

          {canPlace && (
            <LightingGridEditor
              circuits={circuits}
              nameOf={nameOf}
              colors={colors}
              counts={lampCounts}
              painting={painting}
              onPaint={(id) => {
                setPainting(id);
                // Arming and painting are two different answers to "what does a click on the
                // frame mean". Only one may be true.
                if (id !== null) setArmed(null);
              }}
              grid={lampGrid}
              onGrid={setLampGrid}
            />
          )}

          {deeper > 0 && (
            <p className="space-plan__note">
              {deeper} device{deeper === 1 ? ' is' : 's are'} in spaces inside this one. Each space
              has its own plan — open it above to position them.
            </p>
          )}

          {armed !== null && canPlace && (
            <div className="space-plan__selected">
              <span className="space-plan__selected-name">{nameOf(armed)}</span>
              {armedPoint === null ? (
                <>
                  <span className="space-plan__hint">Click the plan to place it</span>
                  <button type="button" className="space-plan__btn" onClick={() => void placeOnPlan(armed, KEYBOARD_START)}>
                    {/* The accessible path. Naming the middle is a choice an operator makes, not
                        a position this app invents on their behalf. */}
                    Place in the middle
                  </button>
                </>
              ) : (
                <>
                  <label className="space-plan__axis" htmlFor="space-plan-x">
                    Across %
                  </label>
                  <input
                    id="space-plan-x"
                    className="space-plan__axis-input"
                    type="number"
                    min={0}
                    max={100}
                    step={1}
                    value={Math.round(armedPoint.x * 100)}
                    onChange={(e) => setAxis('x', e.target.value)}
                  />
                  <label className="space-plan__axis" htmlFor="space-plan-y">
                    Down %
                  </label>
                  <input
                    id="space-plan-y"
                    className="space-plan__axis-input"
                    type="number"
                    min={0}
                    max={100}
                    step={1}
                    value={Math.round(armedPoint.y * 100)}
                    onChange={(e) => setAxis('y', e.target.value)}
                  />
                  <button type="button" className="space-plan__btn" onClick={() => void placeOnPlan(armed, null)}>
                    {/* Not "remove": the device stays in the room, which is a different claim
                        from where in the room it is. */}
                    Take off the plan
                  </button>
                </>
              )}
              <button type="button" className="space-plan__btn" onClick={() => setArmed(null)}>
                Done
              </button>
            </div>
          )}

          {unpositioned.length > 0 && (
            <div className="space-plan__unpositioned" data-testid="plan-unpositioned">
              <h4 className="space-plan__subhead">
                In this space, not on the plan
                <InfoHint label="Why these are listed separately">
                  These devices are in this space, but nobody has said where. Drawing them
                  somewhere — the middle, a corner — would be a position nobody chose, shown as
                  confidently as one somebody did.
                </InfoHint>
              </h4>
              <ul className="space-plan__list">
                {unpositioned.map((device) => (
                  <li key={device.id} className="space-plan__list-item">
                    <StatusDot stale={isReadingStale(readings[device.id])} />
                    <span>{nameOf(device.id)}</span>
                    {canPlace && (
                      <button
                        type="button"
                        className="space-plan__btn space-plan__btn--small"
                        aria-label={`Place ${nameOf(device.id)}`}
                        onClick={() => setArmed(device.id)}
                      >
                        Place
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Pin({
  device,
  name,
  point,
  stale,
  selected,
  selectable,
  onSelect,
}: {
  device: Device;
  name: string;
  point: PlanPoint;
  stale: boolean;
  selected: boolean;
  selectable: boolean;
  onSelect: () => void;
}) {
  const style = { left: `${point.x * 100}%`, top: `${point.y * 100}%` };
  const className = `space-plan__pin${stale ? ' space-plan__pin--stale' : ''}${selected ? ' space-plan__pin--selected' : ''}`;
  const label = `${name}${stale ? ' — no recent reading' : ''}`;

  // A button only where clicking it does something. A control that looks interactive and is not
  // is worse than a plain marker.
  if (!selectable) {
    return (
      <span className={className} style={style} data-testid={`plan-pin-${device.id}`} title={label}>
        <span className="space-plan__pin-label">{name}</span>
      </span>
    );
  }
  return (
    <button
      type="button"
      className={className}
      style={style}
      data-testid={`plan-pin-${device.id}`}
      aria-pressed={selected}
      title={label}
      onClick={(e) => {
        // The frame's own handler would otherwise read this click as "place the armed device
        // here", moving a pin the operator was only selecting.
        e.stopPropagation();
        onSelect();
      }}
    >
      <span className="space-plan__pin-label">{name}</span>
    </button>
  );
}

/**
 * Every device, under the space it is in — the view a site sees before anyone positions
 * anything, and the reason this phase is not just a renderer. A blank frame at a fresh site is
 * indistinguishable from a broken one; this is immediately useful and needs nothing drawn.
 */
function PlacementIndex({
  groups,
  nameOf,
  readings,
  onOpen,
}: {
  groups: ReturnType<typeof groupByPlacement>;
  nameOf: (id: string) => string;
  readings: Record<string, import('@/lib/types').Reading>;
  onOpen: (nodeId: string) => void;
}) {
  if (groups.length === 0) {
    return <p className="space-plan__note">No devices yet.</p>;
  }
  return (
    <ul className="space-plan__groups">
      {groups.map((group) => (
        <li key={group.nodeId ?? '__unplaced'} className="space-plan__group">
          {group.nodeId === null ? (
            <h4 className="space-plan__subhead">{group.label}</h4>
          ) : (
            <h4 className="space-plan__subhead">
              <button type="button" className="space-plan__group-open" onClick={() => onOpen(group.nodeId as string)}>
                {group.label}
              </button>
            </h4>
          )}
          <ul className="space-plan__list">
            {group.ids.map((id) => (
              <li key={id} className="space-plan__list-item">
                <StatusDot stale={isReadingStale(readings[id])} />
                <span>{nameOf(id)}</span>
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}

/** Online or not, and nothing more. Every device class has a reading or has not; anything richer
 * would have to be per-class, and this view deliberately knows nothing about classes. */
function StatusDot({ stale }: { stale: boolean }) {
  return (
    <span
      className={`space-plan__dot${stale ? ' space-plan__dot--stale' : ''}`}
      aria-label={stale ? 'No recent reading' : 'Reporting'}
      role="img"
    />
  );
}
