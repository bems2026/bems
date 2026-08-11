import { useDeviceStore } from '@/stores/deviceStore';
import { topByPower } from './overviewMath';

const LIMIT = 8;

/** Horizontal power-draw bars, image 5's pattern. Only devices with an actual reading appear. */
export function EnergyByDevice() {
  const devices = useDeviceStore((s) => s.devices);
  const readings = useDeviceStore((s) => s.latestReadings);
  const bars = topByPower(devices, readings, LIMIT);
  const max = bars.length ? bars[0].power_w : 1;

  // Flat opaque, not glass — a dense row-per-device grid with nothing behind it but the
  // flat app background; see .card--flat's comment in index.css.
  return (
    <div className="card card--flat energy-by-device-card">
      <div className="card-head">
        <h3 className="card-title">Energy by Device</h3>
        <span className="card-sub">Current power draw</span>
      </div>
      {bars.length === 0 ? (
        <p className="section-placeholder">No devices reporting power yet.</p>
      ) : (
        <div className="power-bars">
          {bars.map((b) => (
            <div className="power-bar" key={b.id}>
              <span className="power-bar__label">{b.label}</span>
              <div className="power-bar__track">
                <div className="power-bar__fill" style={{ width: `${max > 0 ? (b.power_w / max) * 100 : 0}%` }} />
              </div>
              <span className="power-bar__value">{b.power_w.toFixed(0)} W</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
