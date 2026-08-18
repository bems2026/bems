import { useEffect, useId, useRef } from 'react';
import { Card } from '@/components/ui/Card';
import { ConfirmModal } from '@/components/ui/ConfirmModal';
import { useConfirm } from '@/components/ui/useConfirm';
import { useDeviceConfigStore } from '@/stores/deviceConfigStore';
import { CATEGORY_OPTIONS, LOAD_SHED_OPTIONS, effectiveConfig, knownRooms, type DeviceConfigField } from '@/lib/deviceConfig';
import type { Device } from '@/lib/types';

interface DeviceMetaEditorProps {
  device: Device;
  onClose: () => void;
}

/**
 * The operator-editable half of the deferred onboarding wizard (architecture plan Phase 7) —
 * room, functional category, load-shed group, a display-name override, and notes, staged in
 * `deviceConfigStore` and written to Supabase's `device_config` table on confirm.
 *
 * A non-modal panel above the table, not a modal/drawer: the confirm gate below is ITSELF an
 * `aria-modal` alertdialog, and nesting one modal inside another means two competing Escape
 * handlers. This panel's own Escape handler defers to the confirm dialog while it's open (see
 * the effect below) rather than fighting it for the keypress.
 */
export function DeviceMetaEditor({ device, onClose }: DeviceMetaEditorProps) {
  const draft = useDeviceConfigStore((s) => s.draft);
  const saved = useDeviceConfigStore((s) => s.saved);
  const setDraftField = useDeviceConfigStore((s) => s.setDraftField);
  const save = useDeviceConfigStore((s) => s.save);
  const saveStatus = useDeviceConfigStore((s) => s.saveStatus);
  const saveError = useDeviceConfigStore((s) => s.saveError);

  const config = effectiveConfig(draft, saved, device.id);
  const rooms = knownRooms(saved);
  const hasDraft = draft[device.id] !== undefined;

  const headingRef = useRef<HTMLHeadingElement>(null);
  const roomListId = useId();
  const { ask, modalProps } = useConfirm();

  // Focus moves to the panel's own heading on open/device-switch — the non-trapping half of
  // modal hygiene, without the trap: a screen reader user lands here, but Tab still reaches
  // the rest of the page, on purpose.
  useEffect(() => {
    headingRef.current?.focus();
  }, [device.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // The confirm dialog gets Escape first while it's open — ConfirmModal's own listener
      // closes it. Closing the editor underneath at the same time would drop whatever the
      // operator was about to confirm with no feedback at all.
      if (e.key === 'Escape' && !modalProps.open) onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, modalProps.open]);

  const field = (f: DeviceConfigField, value: string) => setDraftField(device.id, f, value);

  const askSave = () =>
    ask(
      {
        title: 'Save device metadata?',
        body: `This writes room, category, load-shed group, display name, and notes for ${device.display_name} (${device.id}) to Supabase.`,
        confirmLabel: 'Save metadata',
        tone: 'blue',
      },
      () => void save(device.id),
    );

  return (
    <Card className="device-meta-editor">
      <div className="device-meta-editor__head">
        <h2 className="card-title device-meta-editor__heading" tabIndex={-1} ref={headingRef}>
          Edit metadata — {device.display_name} <span className="mono device-meta-editor__id">{device.id}</span>
        </h2>
        <button type="button" className="device-meta-editor__close" onClick={onClose}>
          Close
        </button>
      </div>

      <div className="device-meta-editor__grid">
        <label className="device-meta-editor__field">
          <span>Room</span>
          <input type="text" list={roomListId} value={config.room ?? ''} placeholder={device.room ?? 'Not recorded'} onChange={(e) => field('room', e.target.value)} />
          <datalist id={roomListId}>
            {rooms.map((room) => (
              <option key={room} value={room} />
            ))}
          </datalist>
        </label>

        <label className="device-meta-editor__field">
          <span>Category</span>
          <select value={config.category ?? ''} onChange={(e) => field('category', e.target.value)}>
            <option value="">Not set</option>
            {CATEGORY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>

        <label className="device-meta-editor__field">
          <span>Load-shed group</span>
          <select value={config.loadShedGroup ?? ''} onChange={(e) => field('loadShedGroup', e.target.value)}>
            <option value="">Not set</option>
            {LOAD_SHED_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <span className="device-meta-editor__hint">Recorded only — nothing sheds automatically from this yet.</span>
        </label>

        <label className="device-meta-editor__field">
          <span>Display name override</span>
          <input type="text" value={config.displayNameOverride ?? ''} placeholder={device.display_name} onChange={(e) => field('displayNameOverride', e.target.value)} />
        </label>

        <label className="device-meta-editor__field device-meta-editor__field--wide">
          <span>Notes</span>
          <textarea rows={3} maxLength={500} value={config.notes ?? ''} onChange={(e) => field('notes', e.target.value)} />
        </label>
      </div>

      {saveStatus === 'error' && (
        <p className="device-meta-editor__error" role="alert">
          {saveError}
        </p>
      )}

      <div className="device-meta-editor__actions">
        <button type="button" className="device-meta-editor__save" disabled={!hasDraft || saveStatus === 'saving'} onClick={askSave}>
          {saveStatus === 'saving' ? 'Saving…' : 'Save metadata'}
        </button>
      </div>

      <ConfirmModal {...modalProps} />
    </Card>
  );
}
