import { useMemo, useRef, useState } from 'react';
import { OverlayPanel } from '@/components/ui/OverlayPanel';
import { DeviceCard } from './DeviceCard';
import { DeviceMetaEditor } from './DeviceMetaEditor';
import { RemoveDevicePanel } from './RemoveDevicePanel';
import type { Device } from '@/lib/types';

type TabId = 'capabilities' | 'metadata' | 'remove';

interface TabSpec {
  id: TabId;
  label: string;
}

/**
 * Everything about one device, behind one button.
 *
 * WHAT THIS REPLACES. Each fleet row carried `Details`, `Edit` and — for an enrolled device —
 * `Remove`, three buttons packed into a `0.6fr` column of a nine-column grid. They were flush
 * against each other, too small for the kiosk touchscreen until RM-059 gave them a height
 * minimum, and they opened three panels that were all answering questions about the same device.
 * The operator's complaint was the buttons; the actual fault was that one thing had three doors.
 *
 * TABS RATHER THAN A LONGER PANEL, because these three are not sections of one document. What a
 * device can do is read live and changes every couple of seconds; what it is called is a form you
 * submit; removing it is destructive and needs its own preview. Stacking them would make the
 * common case (glance at the telemetry) scroll past the rare one, and Remove is not something to
 * scroll past at all.
 *
 * REMOVE IS A TAB ONLY WHEN THE DEVICE CAN BE REMOVED. The built-in devices are hand-written in
 * `registry.mjs` and no script can remove them, so the tab is absent rather than disabled — the
 * same judgement `DevicesView` already made about the button it replaces: a disabled control
 * invites a click and then explains itself, which is worse than an absent one.
 *
 * The panel's own chrome (surface, heading, close, focus trap, scroll lock, Escape) is
 * `OverlayPanel`'s. The nested save/remove confirmations are `ConfirmModal`s inside these tabs,
 * and `OverlayPanel` stands down while one is up without being told.
 */
export function DevicePanel({
  device,
  canRemove,
  onClose,
  onRemoved,
}: {
  device: Device;
  canRemove: boolean;
  onClose: () => void;
  onRemoved: () => void;
}) {
  const tabs = useMemo<TabSpec[]>(
    () => [
      { id: 'capabilities', label: 'Capabilities' },
      { id: 'metadata', label: 'Metadata' },
      ...(canRemove ? [{ id: 'remove' as const, label: 'Remove' }] : []),
    ],
    [canRemove],
  );
  // Opens on Capabilities every time. Remembering the last tab sounds helpful and is not: the
  // reason you open a device is usually to look at it, and a panel that opens on a destructive
  // tab because that is where you were last is a trap.
  const [active, setActive] = useState<TabId>('capabilities');
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  /**
   * Roving tabindex plus arrow keys — what `role="tablist"` actually promises. Without it the
   * tabs are three separate tab stops that announce themselves as a tablist and then do not
   * behave like one, which is worse than plain buttons would have been.
   */
  const onTabKey = (e: React.KeyboardEvent, index: number) => {
    const delta = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    let next: number | null = null;
    if (delta !== 0) next = (index + delta + tabs.length) % tabs.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = tabs.length - 1;
    if (next === null) return;
    e.preventDefault();
    const id = tabs[next].id;
    setActive(id);
    tabRefs.current[id]?.focus();
  };

  return (
    <OverlayPanel
      className="device-panel"
      onClose={onClose}
      title={
        <>
          {device.display_name} <span className="mono device-panel__id">{device.id}</span>
        </>
      }
      toolbar={
        <div className="device-panel__tabs" role="tablist" aria-label={`${device.display_name} views`}>
          {tabs.map((t, i) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={`device-tab-${t.id}`}
              aria-selected={active === t.id}
              aria-controls={`device-tabpanel-${t.id}`}
              tabIndex={active === t.id ? 0 : -1}
              ref={(el) => {
                tabRefs.current[t.id] = el;
              }}
              className={`device-panel__tab${active === t.id ? ' device-panel__tab--on' : ''}${t.id === 'remove' ? ' device-panel__tab--danger' : ''}`}
              onClick={() => setActive(t.id)}
              onKeyDown={(e) => onTabKey(e, i)}
            >
              {t.label}
            </button>
          ))}
        </div>
      }
    >
      {/*
        One panel element per tab rather than a shared container, so `aria-controls` on each tab
        points at something real. Only the active one is rendered: the Capabilities tab subscribes
        to a live reading and the Remove tab fires a dry-run preview on mount, and neither should
        be doing that while you are typing in the other.
      */}
      <div
        className="device-panel__body"
        role="tabpanel"
        id={`device-tabpanel-${active}`}
        aria-labelledby={`device-tab-${active}`}
        tabIndex={0}
      >
        {active === 'capabilities' && <DeviceCard device={device} />}
        {active === 'metadata' && <DeviceMetaEditor device={device} />}
        {active === 'remove' && <RemoveDevicePanel device={device} onRemoved={onRemoved} />}
      </div>
    </OverlayPanel>
  );
}
