/**
 * Which room a drawn Control plan is showing — RM-037.
 *
 * WHY THE CARD HAS TO SAY. A position is normalised against one space node's frame, so a plan is
 * always a plan OF somewhere. Before this, the Control page drew one surveyed office and could
 * afford to leave the room unnamed; a plan built from data cannot, or a building with three
 * drawn rooms shows one of them with no indication which.
 *
 * ONE ROOM GETS A CAPTION, NOT A PICKER — a select with a single option is a control that does
 * nothing, and it invites the click it will not reward.
 *
 * Renders nothing for the build-time pack: that pack IS one office, and offering to change rooms
 * over it would be offering a choice that does not exist.
 */
import type { ControlPlanState } from './useControlPlan';

export function PlanRoomPicker({
  id,
  source,
  rooms,
  roomId,
  setRoomId,
}: { id: string } & Pick<ControlPlanState, 'source' | 'rooms' | 'roomId' | 'setRoomId'>) {
  if (source !== 'data' || roomId === null) return null;

  if (rooms.length === 1) {
    return <p className="control-plan-panel__room">{rooms[0].label}</p>;
  }

  return (
    <div className="control-plan-panel__room">
      <label className="control-plan-panel__room-label" htmlFor={id}>
        Room
      </label>
      <select id={id} className="control-plan-panel__room-select" value={roomId} onChange={(e) => setRoomId(e.target.value)}>
        {rooms.map((room) => (
          <option key={room.id} value={room.id}>
            {room.label}
          </option>
        ))}
      </select>
    </div>
  );
}
