import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { EventDrivenPanel } from './EventDrivenPanel';
import { useAcuRuleStore } from '@/stores/acuRuleStore';
import { useCapabilitiesStore } from '@/stores/capabilitiesStore';
import type { AcuRule, AcuLoopState } from '@/lib/supabaseAcuRules';
import type { Device } from '@/lib/types';

/**
 * The Event-Driven tab. Its most important job on THIS site is explaining why it is doing
 * nothing: `acu_main` and `sens_outside_temp` have never been paired (RM-016), so every rule
 * holds on `acu_offline`. The assertions about the status strip and the sensor caveat are the
 * ones that matter; the rest is wiring.
 */

const save = vi.fn();
const setEnabled = vi.fn();
const remove = vi.fn();

const dev = (id: string, name: string, cls: Device['class'], extra: Partial<Device> = {}): Device =>
  ({ id, display_name: name, class: cls, room: null, dps_map: null, status: 'active', ...extra }) as Device;

const ACU = dev('acu_main', 'CARE ACU IR', 'acu_ir', { measures: 'return_air' } as Partial<Device>);
const OUTSIDE = dev('sens_outside_temp', 'Outside Temp', 'sensor_temp_humidity', { measures: 'outdoor_air' } as Partial<Device>);
const LIGHT = dev('l1', 'Light Switch 1', 'switch');

const rule = (over: Partial<AcuRule> = {}): AcuRule => ({
  id: 'r1',
  acuDeviceId: 'acu_main',
  sensorDeviceId: 'sens_outside_temp',
  targetC: 24,
  deadbandC: 0.5,
  stepC: 1,
  minStepIntervalS: 600,
  manualHoldS: 600,
  days: '1111100',
  windowStart: '08:00',
  windowEnd: '17:00',
  enabled: true,
  label: 'Office hours',
  overrideReason: null,
  updatedBy: '33333333-3333-3333-3333-333333333333',
  ...over,
});

const loopState = (over: Partial<AcuLoopState> = {}): AcuLoopState => ({
  ruleId: 'r1',
  commandedC: null,
  lastStepAt: null,
  lastDirection: null,
  lastReason: null,
  lastEvaluatedAt: null,
  alertKind: null,
  alertSince: null,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  useAcuRuleStore.setState({ rules: [], loopState: {}, status: 'ready', loadError: null, busy: {}, rowError: {}, save, setEnabled, remove });
  useCapabilitiesStore.setState({ acuMinRoomTargetC: 24, policySource: 'database' });
});

afterEach(() => {
  cleanup();
  useAcuRuleStore.setState({ rules: [], loopState: {}, status: 'idle', loadError: null, busy: {}, rowError: {} });
});

describe('EventDrivenPanel — what it offers', () => {
  it('refuses to offer a rule when the site has no aircon, and says which half is missing', () => {
    render(<EventDrivenPanel devices={[LIGHT, OUTSIDE]} />);
    expect(screen.getByText(/no IR-commandable aircon/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /add rule/i })).toBeDisabled();
  });

  it('an aircon alone IS enough — it reports its own return air, so it can close on itself', () => {
    // Worth pinning: it means a site never has an aircon it cannot write a rule for, and it is
    // why the empty state only ever mentions the missing aircon.
    render(<EventDrivenPanel devices={[ACU, LIGHT]} />);
    expect(screen.getByRole('button', { name: /add rule/i })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: /add rule/i }));
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ acuDeviceId: 'acu_main', sensorDeviceId: 'acu_main' }));
  });

  it('a new rule starts DISARMED — a rule that starts armed acts before anyone has read it', () => {
    render(<EventDrivenPanel devices={[ACU, OUTSIDE]} />);
    fireEvent.click(screen.getByRole('button', { name: /add rule/i }));
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ enabled: false }));
  });

  it('a new rule opens at the building policy rather than a number nobody chose', () => {
    useCapabilitiesStore.setState({ acuMinRoomTargetC: 26, policySource: 'database' });
    render(<EventDrivenPanel devices={[ACU, OUTSIDE]} />);
    fireEvent.click(screen.getByRole('button', { name: /add rule/i }));
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ targetC: 26 }));
  });

  it('names the strategies with no field devices, and what each is blocked on', () => {
    render(<EventDrivenPanel devices={[ACU, OUTSIDE]} />);
    expect(screen.getByText(/Occupancy-driven lighting/i)).toBeInTheDocument();
    expect(screen.getByText(/open procurement question/i)).toBeInTheDocument();
    expect(screen.getByText(/CO₂-driven ventilation/i)).toBeInTheDocument();
    expect(screen.getByText(/Daylight-driven lighting and blinds/i)).toBeInTheDocument();
  });

  it('says the daylight hardware is uninstalled, not that the feature is merely unwritten', () => {
    // The distinction this asserts is the whole point of `blockedOn` being required: an operator
    // reading "coming soon" waits, and an operator reading "the sensor is not mounted yet" knows
    // it is theirs to unblock. Both devices are also UNREPRESENTABLE rather than just unenrolled
    // — nothing in the catalogue reads a light level and no blind class exists — so the card must
    // not imply the only missing step is screwing the sensor to a wall.
    render(<EventDrivenPanel devices={[ACU, OUTSIDE]} />);
    expect(screen.getByText(/neither of them physically installed/i)).toBeInTheDocument();
    expect(screen.getByText(/no blind or shade class in the registry/i)).toBeInTheDocument();
  });
});

describe('EventDrivenPanel — the sensor caveat', () => {
  it('warns that an OUTDOOR sensor can never reach a room target', () => {
    // `sens_outside_temp` is a temperature source, so a naive picker offers it — and a rule
    // closed on it is a configuration mistake that presents as a bug.
    useAcuRuleStore.setState({ rules: [rule()] });
    render(<EventDrivenPanel devices={[ACU, OUTSIDE]} />);
    expect(screen.getByText(/can never reach a room target/i)).toBeInTheDocument();
  });

  it('warns that the aircon own reading is RETURN AIR, which settles colder than the target', () => {
    useAcuRuleStore.setState({ rules: [rule({ sensorDeviceId: 'acu_main' })] });
    render(<EventDrivenPanel devices={[ACU, OUTSIDE]} />);
    expect(screen.getByText(/settles colder than its target/i)).toBeInTheDocument();
  });
});

describe('EventDrivenPanel — the status strip', () => {
  it('says the rule is disarmed rather than leaving it blank', () => {
    useAcuRuleStore.setState({ rules: [rule({ enabled: false })] });
    render(<EventDrivenPanel devices={[ACU, OUTSIDE]} />);
    expect(screen.getByText(/Disarmed — the controller ignores this rule/i)).toBeInTheDocument();
  });

  it('explains acu_offline as something to DO, not as an error code', () => {
    // The branch every rule on this site actually reaches. A raw `acu_offline` would tell the
    // one person who can get the blaster paired nothing at all.
    useAcuRuleStore.setState({ rules: [rule()], loopState: { r1: loopState({ lastReason: 'acu_offline' }) } });
    render(<EventDrivenPanel devices={[ACU, OUTSIDE]} />);
    expect(screen.getByText(/never been paired to the vendor account/i)).toBeInTheDocument();
    expect(screen.queryByText('acu_offline')).not.toBeInTheDocument();
  });

  it('shows the commanded setpoint and when it last stepped', () => {
    useAcuRuleStore.setState({
      rules: [rule()],
      loopState: { r1: loopState({ commandedC: 22, lastStepAt: '2026-08-24T10:15:00', lastDirection: 'down', lastReason: 'rate_limited' }) },
    });
    render(<EventDrivenPanel devices={[ACU, OUTSIDE]} />);
    expect(screen.getByText('22°C')).toBeInTheDocument();
    expect(screen.getByText(/last stepped down at 10:15/)).toBeInTheDocument();
    expect(screen.getByText(/Waiting out the interval/i)).toBeInTheDocument();
  });

  it('renders the floor alert with its timestamp', () => {
    useAcuRuleStore.setState({
      rules: [rule()],
      loopState: { r1: loopState({ commandedC: 16, alertKind: 'floor_reached', alertSince: '2026-08-24T13:40:00', lastReason: 'at_hardware_floor' }) },
    });
    render(<EventDrivenPanel devices={[ACU, OUTSIDE]} />);
    expect(screen.getByText(/Stuck at the 16 °C floor/i)).toBeInTheDocument();
    expect(screen.getByText(/since 13:40/)).toBeInTheDocument();
  });

  it('says the controller has not reported yet rather than implying it is working', () => {
    useAcuRuleStore.setState({ rules: [rule()], loopState: {} });
    render(<EventDrivenPanel devices={[ACU, OUTSIDE]} />);
    expect(screen.getByText(/has not reported on this rule yet/i)).toBeInTheDocument();
  });
});

describe('EventDrivenPanel — the below-policy override', () => {
  it('asks for a written reason only when the target is below the policy', () => {
    useAcuRuleStore.setState({ rules: [rule({ targetC: 24 })] });
    const { rerender } = render(<EventDrivenPanel devices={[ACU, OUTSIDE]} />);
    expect(screen.queryByLabelText(/Reason for the below-policy target/i)).not.toBeInTheDocument();

    useAcuRuleStore.setState({ rules: [rule({ targetC: 20 })] });
    rerender(<EventDrivenPanel devices={[ACU, OUTSIDE]} />);
    expect(screen.getByLabelText(/Reason for the below-policy target/i)).toBeInTheDocument();
    expect(screen.getByText(/below this building's 24°C room-comfort policy/i)).toBeInTheDocument();
  });

  it('a failed save is reported next to the rule that caused it', () => {
    useAcuRuleStore.setState({ rules: [rule()], rowError: { r1: 'a room target of 20C is below this site’s 24C room-comfort policy' } });
    render(<EventDrivenPanel devices={[ACU, OUTSIDE]} />);
    expect(screen.getByRole('alert')).toHaveTextContent(/room-comfort policy/i);
  });
});
