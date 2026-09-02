import { useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useDeviceStore } from '@/stores/deviceStore';
import { capabilitiesOf } from '@/lib/capabilitySchema';
import { CLASS_ICON } from '@/lib/deviceIcons';
import { DEVICE_CLASS_CATALOG } from '@/lib/deviceClassCatalog';
import { StaleDataBadge } from '@/components/common/StaleDataBadge';
import type { Device } from '@/lib/types';
import { widgetsFor } from './widgetRegistry';

/**
 * One device, rendered from what its hardware can actually do.
 *
 * WHAT THIS REPLACES. Control was hardcoded per class: `SwitchesListCard` knew switches had a
 * toggle, `OutletsListCard` knew outlets had two, and nothing anywhere knew an outlet reports a
 * child lock, a fault bitmap or a power-on mode — because there was no place to say so. Adding a
 * capability meant editing components. Now it means adding an entry to
 * `shared/deviceCapabilities.mjs` and a widget to `capabilityWidgets.tsx`; this file does not
 * change, and neither does any page.
 *
 * A device that lacks a capability renders nothing for it — not an empty box, not a zero, not a
 * crash — because the widget was never mounted. See `capabilityWidgets.tsx` on why that decision
 * reads the product rather than the reading.
 */
export function DeviceCard({ device }: { device: Device }) {
  const reading = useDeviceStore((s) => s.latestReadings[device.id]);
  const sibling = useChannelSibling(device);
  const [shown, setShown] = useState<Device>(device);

  // The tab bar switches which logical device is rendered. Both are real registry entries with
  // their own readings, so this is a choice of subject, not a filter over one.
  const active = sibling ? shown : device;
  const activeReading = useDeviceStore((s) => s.latestReadings[active.id]);
  const caps = useMemo(() => capabilitiesOf(active, activeReading), [active, activeReading]);
  const widgets = useMemo(() => widgetsFor(caps, active), [caps, active]);

  const Icon = CLASS_ICON[active.class];
  const spec = DEVICE_CLASS_CATALOG[active.class];

  return (
    <StaleDataBadge deviceId={active.id} label={active.display_name} className="device-card">
      <div className="device-card__head">
        <span className="device-card__title">
          <Icon size={16} className="title-icon" aria-hidden="true" />
          {active.display_name}
        </span>
        <span className="device-card__pill">{spec.pill}</span>
      </div>

      {active.branch_circuit && <p className="device-card__sub">{active.branch_circuit}</p>}

      {sibling && (
        <div className="device-card__tabs" role="tablist" aria-label={`${device.display_name} channels`}>
          {[device, sibling].map((d) => (
            <button
              key={d.id}
              type="button"
              role="tab"
              aria-selected={active.id === d.id}
              className={`device-card__tab${active.id === d.id ? ' device-card__tab--on' : ''}`}
              onClick={() => setShown(d)}
            >
              Ch {d.channel} · {d.display_name}
            </button>
          ))}
        </div>
      )}

      <div className="device-card__body" role={sibling ? 'tabpanel' : undefined}>
        {widgets.length === 0 ? (
          // Honest, and different from a blank card: this device reports nothing we can decode,
          // which for the IR blaster and the ambient sensor is simply true.
          <p className="device-card__empty">
            {caps.profileId ? 'No capabilities reported yet.' : 'This device reports no data points.'}
          </p>
        ) : (
          widgets.map(({ id, Component }) => (
            <div key={id} className="device-card__widget">
              <Component device={active} caps={caps} reading={activeReading} />
            </div>
          ))
        )}
      </div>

      {!reading && <p className="device-card__empty">No reading yet.</p>}
    </StaleDataBadge>
  );
}

/**
 * The other half of a dual-channel product, if there is exactly one.
 *
 * One physical dual-channel CT meter appears in the registry as TWO logical devices, deliberately
 * — `shared/sites/.../devices.mjs` records that "device identity here is the logical meter id,
 * never the Tuya device id", because the two channels feed different branch circuits and are
 * meaningful separately.
 *
 * So the pairing has to be inferred, and it is only safe to infer while one such product exists.
 * With a second dual-channel meter on site there would be two candidates and no way to tell
 * which belongs to which — the registry carries no physical-device id to join on, on purpose.
 * Rather than guess and pair two unrelated branch circuits under one card, this returns `null`
 * and the card renders as a single channel, which is merely less convenient instead of wrong.
 */
function useChannelSibling(device: Device): Device | null {
  const candidates = useDeviceStore(
    useShallow((s) =>
      s.devices
        .filter(
          (d) =>
            d.id !== device.id &&
            d.capability_profile != null &&
            d.capability_profile === device.capability_profile &&
            d.channel != null &&
            d.channel !== device.channel,
        )
        .map((d) => d.id),
    ),
  );
  const devices = useDeviceStore((s) => s.devices);
  return useMemo(() => {
    if (device.channel == null || candidates.length !== 1) return null;
    return devices.find((d) => d.id === candidates[0]) ?? null;
  }, [candidates, devices, device.channel]);
}
