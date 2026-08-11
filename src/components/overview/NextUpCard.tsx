/**
 * v4's "Active Schedules" card, retitled "Next up" per the Phase M plan — v3's
 * chronologically-sorted "what happens next" is a more useful frame than v4's unsorted
 * "what's currently armed", and once M4's schedule data exists this card should show the
 * next few armed schedules by time-of-day, not registry order.
 *
 * No schedule data exists anywhere in this app yet — `POST /api/context` and the
 * Automation page that writes to it are M4. Rendering a sample schedule here would be
 * exactly the kind of fabricated reading this app has never done; "No data" is correct
 * until there's something real to show.
 */
export function NextUpCard() {
  return (
    <div className="card">
      <div className="card-head">
        <h3 className="card-title">Next up</h3>
        <span className="card-sub">Node-RED global context</span>
      </div>
      <p className="section-placeholder">No schedules armed — No data</p>
    </div>
  );
}
