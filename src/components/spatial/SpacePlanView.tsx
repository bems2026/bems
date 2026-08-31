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
 * THE FRAME IS NORMALISED SPACE, NOT A SURVEY. It is square because nothing here has measured a
 * room. Giving it invented proportions would assert a fact nobody established, which is the same
 * failure this project spends its effort avoiding elsewhere. When `space_nodes.attrs` carries
 * real dimensions, a 0..1 position converts into them without being re-entered.
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
import { resolveDisplayName } from '@/lib/deviceConfig';
import { isReadingStale } from '@/lib/staleness';
import { InfoHint } from '@/components/ui/InfoHint';
import type { Device } from '@/lib/types';

/** Where an unpositioned device lands when it is placed from the keyboard rather than by
 * pointing. The middle is not a survey and is not offered as one — it is behind a button that
 * says so, after which the two number fields refine it. */
const KEYBOARD_START: PlanPoint = { x: 0.5, y: 0.5 };

export function SpacePlanView({ editable = false }: { editable?: boolean }) {
  const devices = useDeviceStore((s) => s.devices);
  const readings = useDeviceStore((s) => s.latestReadings);
  const saved = useDeviceConfigStore((s) => s.saved);
  const placeOnPlan = useDeviceConfigStore((s) => s.placeOnPlan);
  const saveError = useDeviceConfigStore((s) => s.saveError);
  const nodes = useSpaceTreeStore((s) => s.nodes);
  const configured = useSpaceTreeStore((s) => s.canEdit);

  const [nodeId, setNodeId] = useState('');
  /** The device currently being positioned — armed from the tray, or selected by clicking its
   * pin. One piece of state for both, because they are the same act at different stages. */
  const [armed, setArmed] = useState<string | null>(null);

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
          No spaces defined yet. Add them from Spaces on the Devices page, then place devices into
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
            // A device armed in one room means nothing in another.
            setArmed(null);
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
            className="space-plan__frame"
            data-testid="plan-frame"
            onClick={onFrameClick}
            aria-label={`Plan of ${pathLabel(nodes, nodeId)}`}
          >
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
                  selectable={canPlace}
                  onSelect={() => setArmed(device.id)}
                />
              );
            })}
            {positioned.length === 0 && (
              <p className="space-plan__frame-empty">
                {/* An empty frame with no explanation reads as a failed render. */}
                Nothing on this plan yet.
                {canPlace && ' Choose a device below, then click where it sits.'}
              </p>
            )}
          </div>

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
