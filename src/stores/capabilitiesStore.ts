import { create } from 'zustand';
import { getCapabilities } from '@/lib/bridgeClient';
import { createRetrySchedule } from './retrySchedule';

const retry = createRetrySchedule();

interface CapabilitiesState {
  /** `null` until the first successful load — deliberately treated the SAME as `false`
   * everywhere the UI reads this (see `ControlPage.tsx`'s dispatch banner): never claim
   * hardware dispatch is open before it's actually confirmed open. */
  hardwareDispatchEnabled: boolean | null;
  /** Which device classes actually reach hardware right now. `null` until the first
   * successful load — deliberately distinct from `[]`, which is the server positively
   * confirming that nothing dispatches. `components/control/dispatchScope.ts` treats both as
   * closed, but only one of them is a fact we were actually told. */
  dispatchClasses: string[] | null;
  /**
   * Command audit rows sitting in the Pi's local buffer because Supabase could not be
   * reached. `null` until a proxy actually reports it — a proxy predating the field is
   * unknown, not zero, for the same reason `dispatchClasses` distinguishes the two.
   */
  auditBufferPending: number | null;
  /**
   * Which dispatch paths this site permits (`local-first` / `local-only`), and whether a
   * vendor-cloud fallback is actually configured on this deployment.
   *
   * Both `null` until a proxy that reports them answers — a proxy predating the fields says
   * nothing, which is not the same as saying `local-first`. Kept as a pair because neither is
   * sufficient alone: `local-first` with no credentials set behaves identically to
   * `local-only` today and is a completely different promise about tomorrow.
   */
  dispatchPolicy: string | null;
  cloudFallbackConfigured: boolean | null;
  /**
   * The coldest ROOM TARGET this building permits — RM-038, redefined by RM-068.
   *
   * NOT the build's own `SITE.policy` value: an operator can change it without a redeploy, so a
   * screen built from the build value would state a policy that is no longer in force. `null`
   * means no policy at all, or that the proxy has not answered yet; `policySource` tells them
   * apart.
   *
   * Since RM-068 this no longer narrows the setpoint selector — the number is about the ROOM,
   * and a manual setpoint below it is warned about rather than refused.
   */
  acuMinRoomTargetC: number | null;
  /** `'database'` when the proxy read the live row, `'build'` when it fell back. A page showing
   * a floor it got from the build during an outage should be able to say so. */
  policySource: string | null;
  /**
   * The aircon's cloud route (`ready` / `unconfigured` / `unresolved` / `local-only`) and whether its
   * local IR library has been verified on the unit. `null` until a proxy that reports them answers,
   * and `acuCloudRoute` also `null` at a site with no aircon.
   */
  acuCloudRoute: 'ready' | 'unconfigured' | 'unresolved' | 'local-only' | null;
  acuLocalIrVerified: boolean | null;
  /** `acu_local_ir_protocol`: the protocol the flow generates frames in, or null. */
  acuLocalIrProtocol: string | null;
  load: () => Promise<void>;
}

/**
 * Whether `POST /api/command`'s hardware-dispatch gate is open — architecture plan Phase
 * 6. Loaded once at app start alongside the device catalogue (`useLiveConnection.ts`), not
 * lazily on Control's mount, so the very first render of the dispatch banner is already
 * accurate rather than defaulting open for one frame.
 */
export const useCapabilitiesStore = create<CapabilitiesState>((set) => ({
  hardwareDispatchEnabled: null,
  dispatchClasses: null,
  auditBufferPending: null,
  dispatchPolicy: null,
  cloudFallbackConfigured: null,
  acuMinRoomTargetC: null,
  policySource: null,
  acuCloudRoute: null,
  acuLocalIrVerified: null,
  acuLocalIrProtocol: null,

  // Same retry-with-backoff shape as useLiveConnection.ts's device-catalogue fetch — a
  // failed load here must never get stuck reporting "unknown" forever just because one
  // request over a real network hop dropped.
  load: async () => {
    retry.cancel();
    const attempt = async (): Promise<void> => {
      try {
        const { hardware_dispatch_enabled, dispatch_classes, audit_buffer_pending, dispatch_policy, cloud_fallback_configured, acu_min_room_target_c, acu_min_setpoint_c, policy_source, acu_cloud_route, acu_local_ir_verified, acu_local_ir_protocol } = await getCapabilities();
        retry.succeeded();
        set({
          hardwareDispatchEnabled: hardware_dispatch_enabled,
          // A proxy old enough to predate this field is reported as null (unknown) rather
          // than [], for the same reason the initial value is null: absence of an answer is
          // not the same as an answer of "nothing".
          dispatchClasses: Array.isArray(dispatch_classes) ? dispatch_classes : null,
          auditBufferPending: typeof audit_buffer_pending === 'number' ? audit_buffer_pending : null,
          dispatchPolicy: typeof dispatch_policy === 'string' ? dispatch_policy : null,
          cloudFallbackConfigured: typeof cloud_fallback_configured === 'boolean' ? cloud_fallback_configured : null,
          // New key preferred, old key as the fallback, for the length of the RM-068 rename
          // window — a proxy that predates phase35 still serves only the old one.
          acuMinRoomTargetC: typeof acu_min_room_target_c === 'number' ? acu_min_room_target_c : typeof acu_min_setpoint_c === 'number' ? acu_min_setpoint_c : null,
          policySource: typeof policy_source === 'string' ? policy_source : null,
          acuCloudRoute: typeof acu_cloud_route === 'string' ? acu_cloud_route : null,
          acuLocalIrVerified: typeof acu_local_ir_verified === 'boolean' ? acu_local_ir_verified : null,
          acuLocalIrProtocol: typeof acu_local_ir_protocol === 'string' ? acu_local_ir_protocol : null,
        });
      } catch {
        retry.retryAfterFailure(attempt);
      }
    };
    await attempt();
  },
}));
