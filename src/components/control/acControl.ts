/**
 * The aircon panel's decisions — what it offers, where it opens, what it calls a state, and where a
 * state will go when sent. Pure and separately tested, the split `setpointOptions.ts` makes: the card
 * renders, this decides.
 *
 * The contract itself lives in `shared/acState.mjs`, which the server dispatches with, so the path
 * this panel PREDICTS is computed by the same `localIrKey` the dispatcher uses to CHOOSE.
 */
import { AC_MODES, AC_FANS, AC_DEFAULTS, LOCAL_LIBRARY_STATE, localIrKey, describeAcState } from '@shared/acState.mjs';
import type { AcFan, AcMode, Reading } from '@/lib/types';

export interface AcDraft {
  mode: AcMode;
  setpoint_c: number;
  fan: AcFan;
  swing: boolean;
}

export type AcCloudRoute = 'ready' | 'unconfigured' | 'unresolved' | 'local-only' | null;

const MODE_LABELS: Record<AcMode, string> = { cool: 'Cool', heat: 'Heat', auto: 'Auto', fan: 'Fan', dry: 'Dry' };
const FAN_LABELS: Record<AcFan, string> = { auto: 'Auto', low: 'Low', medium: 'Med', high: 'High' };

export const AC_MODE_OPTIONS: { value: AcMode; label: string }[] = (AC_MODES as AcMode[]).map((value) => ({ value, label: MODE_LABELS[value] }));
export const AC_FAN_OPTIONS: { value: AcFan; label: string }[] = (AC_FANS as AcFan[]).map((value) => ({ value, label: FAN_LABELS[value] }));

/** Where the controls open: the last COMMANDED state, else the defaults the dispatcher would use. */
export function seedDraft(reading: Reading | undefined): AcDraft {
  const sp = reading?.setpoint_c;
  return {
    mode: reading?.ac_mode && (AC_MODES as string[]).includes(reading.ac_mode) ? reading.ac_mode : (AC_DEFAULTS.mode as AcMode),
    setpoint_c: typeof sp === 'number' && Number.isInteger(sp) && sp >= 16 && sp <= 30 ? sp : AC_DEFAULTS.setpoint_c,
    fan: reading?.ac_fan && (AC_FANS as string[]).includes(reading.ac_fan) ? reading.ac_fan : (AC_DEFAULTS.fan as AcFan),
    swing: typeof reading?.ac_swing === 'boolean' ? reading.ac_swing : AC_DEFAULTS.swing,
  };
}

/** "Dry · 22 °C · fan high · swing on" — the words the button, the dialog and the audit note share. */
export function draftSummary(draft: AcDraft): string {
  return describeAcState({ power: 'on', ...draft });
}

/**
 * What the unit was last told, or null when the reading cannot say. Built only from COMMANDED fields:
 * this is a record of intent, and the card labels it "last sent" for that reason.
 */
export function commandedSummary(reading: Reading | undefined): string | null {
  if (!reading) return null;
  if (reading.state === 'off') return 'Off';
  if (typeof reading.setpoint_c !== 'number') return null;
  return describeAcState({ power: 'on', ...seedDraft(reading), setpoint_c: reading.setpoint_c });
}

/**
 * Where an ON state will go, mirroring `dispatchAircon` in `server/dispatchLight.mjs`, or why it
 * cannot go anywhere.
 *
 * `cloud` is the proxy's `acu_cloud_route`. Anything but `ready` — including a proxy that has not
 * said — is treated as no cloud: this panel must never promise a path the server will not find.
 */
export function dispatchPathFor(
  draft: AcDraft,
  caps: { cloud: AcCloudRoute; verified: boolean | null },
): { via: 'local' | 'cloud' } | { blocked: string } {
  const cloudReady = caps.cloud === 'ready';
  const local = localIrKey({ power: 'on', ...draft }) !== null;

  if (local) {
    // Unverified library: the server tries the cloud first when it can, and falls back to the LAN.
    return !caps.verified && cloudReady ? { via: 'cloud' } : { via: 'local' };
  }
  if (cloudReady) return { via: 'cloud' };

  const why =
    caps.cloud === 'local-only'
      ? 'this site is local-only'
      : caps.cloud === 'unconfigured'
        ? 'the vendor cloud is not configured on this deployment'
        : 'the vendor cloud is not answering';
  return {
    blocked: `Only the vendor cloud can send this mode, fan or swing, and ${why}. The local IR library holds ${MODE_LABELS[LOCAL_LIBRARY_STATE.mode as AcMode]}, fan ${LOCAL_LIBRARY_STATE.fan}, swing ${LOCAL_LIBRARY_STATE.swing ? 'on' : 'off'}, at 16–30 °C.`,
  };
}
