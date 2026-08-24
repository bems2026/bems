import { useMemo } from 'react';
import { useDeviceStore } from '@/stores/deviceStore';
import { useDeviceConfigStore } from '@/stores/deviceConfigStore';
import { partitionByFunction, type DeviceFunction } from '@/lib/deviceFunctions';

/**
 * The devices a page should show, and the ones it is deliberately leaving out.
 *
 * Reads `saved` rather than the draft-merged view: an unsaved edit in the metadata editor
 * should not make devices appear and disappear from other pages while someone is still
 * typing. The editor is where a draft is visible; everywhere else sees committed state.
 */
export function useDevicesFor(fn: DeviceFunction) {
  const devices = useDeviceStore((s) => s.devices);
  const configs = useDeviceConfigStore((s) => s.saved);
  return useMemo(() => partitionByFunction(devices, configs, fn), [devices, configs, fn]);
}
