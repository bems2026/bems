/**
 * What the plan's symbols mean, drawn with the plan's own symbols.
 *
 * THE STATE COLOURS, and why they changed (2026-09-29). The plan drew an energised lamp or socket in
 * amber, the lists beside it drew the same relay's "on" in green, and amber is also this app's colour
 * for a warning (a stale reading, a command in flight, a setpoint below policy). So one relay was two
 * colours on one page, and one of them meant "something is wrong" everywhere else. It is one rule now:
 *
 *   on           solid green (`--good`), the colour the lists and the switch tracks already used;
 *   off          hollow, outlined — a shape difference, so it survives without colour;
 *   switching    pulsing, whichever way it is going;
 *   unavailable  dashed and dimmed — no reading, or the bridge reports it offline.
 *
 * Amber stays a warning, and blue stays "press this". A state is never shown as a button's fill.
 *
 * `role="list"` is explicit because `list-style: none` removes a list's semantics in Safari.
 */
export function PlanLegend() {
  return (
    <ul className="control-plan-legend" role="list" aria-label="Plan legend">
      <li>
        <span className="control-legend-swatch control-legend-swatch--on" aria-hidden="true" />
        On
      </li>
      <li>
        <span className="control-legend-swatch" aria-hidden="true" />
        Off
      </li>
      <li>
        <span className="control-legend-swatch control-legend-swatch--busy" aria-hidden="true" />
        Switching
      </li>
      <li>
        <span className="control-legend-swatch control-legend-swatch--unavailable" aria-hidden="true" />
        Unavailable
      </li>
      <li>
        <span className="control-legend-puck" aria-hidden="true">
          <span className="control-legend-puck__half control-legend-puck__half--on" />
          <span className="control-legend-puck__half" />
        </span>
        Outlet: left half S1, right half S2
      </li>
    </ul>
  );
}
