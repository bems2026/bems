import type { ComponentType } from 'react';
import { READ_ONLY_SETTINGS, OPERATOR_DIAGNOSTICS, type ResolvedCapabilities } from '@/lib/capabilitySchema';
import type { Device } from '@/lib/types';
import {
  RelayWidget,
  TelemetryWidget,
  EnergyWidget,
  ChildLockWidget,
  WarnPowerWidget,
  CountdownWidget,
  FaultWidget,
  DiagnosticsWidget,
  SettingsWidget,
  type WidgetProps,
} from './capabilityWidgets';

/**
 * Which widgets a device gets, and why.
 *
 * THE POINT OF THIS TABLE is that adding a capability to `shared/deviceCapabilities.mjs` and a
 * row here is the whole change — no card is edited, no device class is special-cased, and a
 * device that lacks the capability renders nothing rather than an empty box or a crash. Before
 * this, the Control page named each card by hand and a new feature meant touching five
 * components, each of which had drifted into spelling the same rules slightly differently.
 *
 * `when` reads the PRODUCT's capability declaration, never the current reading — see
 * `capabilityWidgets.tsx` on why that distinction is what keeps the layout still.
 */
export interface CapabilityWidget {
  id: string;
  when: (caps: ResolvedCapabilities, device: Device) => boolean;
  Component: ComponentType<WidgetProps>;
}

/**
 * Order matters: what the operator acts on, then what the device is doing, then what it is
 * configured to do on its own. Read top to bottom that is control, measurement, explanation.
 */
export const CAPABILITY_WIDGETS: CapabilityWidget[] = [
  { id: 'relay', when: (caps) => caps.declares('switch_1'), Component: RelayWidget },
  {
    id: 'telemetry',
    when: (caps) => caps.declares('cur_power') && caps.declares('cur_voltage'),
    Component: TelemetryWidget,
  },
  {
    id: 'energy',
    when: (caps) => caps.declares('today_acc_energy') || caps.declares('total_energy'),
    Component: EnergyWidget,
  },
  { id: 'child_lock', when: (caps) => caps.declares('child_lock'), Component: ChildLockWidget },
  { id: 'warn_power', when: (caps) => caps.declares('warn_power'), Component: WarnPowerWidget },
  { id: 'countdown', when: (caps) => caps.declares('countdown_1'), Component: CountdownWidget },
  { id: 'fault', when: (caps) => caps.declares('fault'), Component: FaultWidget },
  {
    // Before the settings row, not after: what the device is doing now outranks how it is
    // configured to behave later, and these two were inside that row until 2026-09-08.
    id: 'diagnostics',
    when: (caps) => OPERATOR_DIAGNOSTICS.some((d) => caps.declares(d)),
    Component: DiagnosticsWidget,
  },
  {
    id: 'settings',
    when: (caps) => READ_ONLY_SETTINGS.some((s) => caps.declares(s)),
    Component: SettingsWidget,
  },
];

/** The widgets that apply to one device — the whole of the "dynamic" in dynamic rendering. */
export function widgetsFor(caps: ResolvedCapabilities, device: Device): CapabilityWidget[] {
  return CAPABILITY_WIDGETS.filter((w) => w.when(caps, device));
}
