import { useEffect, useRef, useState } from 'react';
import { X, RotateCw, Pause, Home, LayoutPanelTop, Pencil, Armchair, Table2, GlassWater, ShelvingUnit, Sofa, Redo2, Copy, ClipboardPaste, Trash2, Save, RotateCcw, Upload, Download } from 'lucide-react';
import { OfficeScene, type PickResult } from './officeScene';
import { FloorPlanView } from '@/components/floorplan/FloorPlanView';
import { useDeviceStore } from '@/stores/deviceStore';
import { Card } from '@/components/ui/Card';
import { MetricValue } from '@/components/ui/MetricValue';
import { Badge } from '@/components/ui/Badge';
import { ConfirmModal } from '@/components/ui/ConfirmModal';
import { useConfirm } from '@/components/ui/useConfirm';
import { loadLayout, saveLayout, clearSavedLayout, parseLayoutJson, clampToRoom, pastePosition, nextRotation, exportLayoutFilename, newItemId, type EditableItem, type EditableKind } from './editableLayout';

/** 7 lighting circuits x 3 fixtures/row, matching `geometry.ts`'s LIGHT_FIXTURES. */
const FIXTURES_PER_CIRCUIT = 3;

function supportsWebGL(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return !!(canvas.getContext('webgl2') || canvas.getContext('webgl'));
  } catch {
    return false;
  }
}

interface Selection {
  deviceId: string;
  socket?: 1 | 2;
}

function pickToSelection(pick: PickResult): Selection | null {
  if (!pick) return null;
  return pick.kind === 'light' ? { deviceId: pick.circuit } : { deviceId: pick.id, socket: pick.socket };
}

const EDITABLE_LABEL: Record<EditableKind, string> = { desk: 'desk', table: 'table', dispenser: 'dispenser', shelf: 'shelf', bench: 'bench' };

/** One "+ Kind" toolbar button per placeable piece — icon + accessible label together, so
 * adding a sixth kind later is one entry here rather than a new hand-written button. */
const PLACE_TOOLS: { kind: EditableKind; label: string; Icon: typeof Armchair }[] = [
  { kind: 'desk', label: 'Add desk', Icon: Armchair },
  { kind: 'table', label: 'Add table', Icon: Table2 },
  { kind: 'dispenser', label: 'Add dispenser', Icon: GlassWater },
  { kind: 'shelf', label: 'Add shelf', Icon: ShelvingUnit },
  { kind: 'bench', label: 'Add bench', Icon: Sofa },
];

/**
 * The 3D CARE office. Self-contained on WebGL support: if the browser can't create a
 * context, this renders `FloorPlanView` itself rather than pushing that decision onto
 * every caller — the 2D plan is already built, tested, and arguably the better dense read
 * of all 14 sockets at once anyway.
 *
 * No animation loop — see `officeScene.ts`'s header comment. That also means there's no
 * idle camera drift to disable under `prefers-reduced-motion`; the scene is already inert
 * except in direct response to a data update or a drag/wheel/click the user just made.
 *
 * Two interaction modes, never both at once:
 *  - Default: hover shows a device tooltip, click opens the read-only device inspector.
 *    Neither calls anything that writes — unchanged from before Edit Layout existed.
 *  - Edit Layout (toggled via the pencil button, alongside auto-rotate/top-down/reset-view):
 *    click places or selects a user-added desk/table instead of a device. The two modes are
 *    kept from cross-firing by branching once, at the top of the pointer-up handler — see
 *    that handler's own comment.
 */
export function OfficeScene3D() {
  const [webgl] = useState(supportsWebGL);
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<OfficeScene | null>(null);
  const draggingRef = useRef(false);
  const lastPointerRef = useRef({ x: 0, y: 0 });
  const movedRef = useRef(false);

  const [hover, setHover] = useState<{ selection: Selection; x: number; y: number } | null>(null);
  const [selected, setSelected] = useState<Selection | null>(null);
  // Checked once, not reactively — a live-changing OS preference mid-session is rare
  // enough that re-rendering on a matchMedia listener isn't worth the complexity, and the
  // control simply doesn't exist for anyone with the preference on at mount.
  const [reducedMotion] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  // v4's default: the scene rotates on its own unless the viewer turns it off (or has
  // prefers-reduced-motion, which never starts it at all — see the mount effect below).
  const [autoRotate, setAutoRotateState] = useState(!reducedMotion);

  // --- Edit Layout: user-placed desks/tables, staged in this component's own state and
  // synced to the scene imperatively (see the `layout`/`selectedEditId` effects below) —
  // same "React owns the data, the imperative scene owns the WebGL side of it" split
  // `applyState`'s store subscription already uses for live device readings.
  const [editMode, setEditMode] = useState(false);
  const [layout, setLayout] = useState<EditableItem[]>(() => loadLayout());
  const [selectedEditId, setSelectedEditId] = useState<string | null>(null);
  const [placeKind, setPlaceKind] = useState<EditableKind | null>(null);
  const [saveStatus, setSaveStatus] = useState<{ at: number; count: number } | null>(null);
  const [layoutError, setLayoutError] = useState<string | null>(null);
  /** What Copy last captured — kind/rotation only; Paste always computes a fresh offset
   * position via `pastePosition()` rather than storing a stale one here. Real state, not a
   * ref: the Paste button's own `disabled` prop reads this every render, and a ref mutation
   * doesn't trigger one — Copy would leave Paste looking permanently disabled until some
   * unrelated re-render happened to catch up (caught by eslint's react-hooks/refs rule). */
  const [clipboard, setClipboard] = useState<{ kind: EditableKind; ry: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { ask, modalProps } = useConfirm();

  const devices = useDeviceStore((s) => s.devices);
  const latestReadings = useDeviceStore((s) => s.latestReadings);
  const litCount = devices.filter((d) => d.class === 'switch' && latestReadings[d.id]?.state === 'on').length * FIXTURES_PER_CIRCUIT;
  const acuState = latestReadings['acu_main']?.state;

  useEffect(() => {
    if (!webgl || !canvasRef.current || !containerRef.current) return;
    const container = containerRef.current;
    const canvas = canvasRef.current;
    const scene = new OfficeScene(canvas);
    sceneRef.current = scene;
    scene.resize(container.clientWidth, container.clientHeight);
    // Debug/verification hook only — attached to the DOM node (not `window`), so it
    // can't leak into anything that doesn't already have a direct reference to this
    // canvas. Lets scene state (mesh counts, per-id material colors) be asserted from
    // outside React without adding a second, parallel state-exposure API.
    (canvas as HTMLCanvasElement & { __officeScene?: OfficeScene }).__officeScene = scene;

    // Store subscription, not the React hook: readings tick every ~2s and should update
    // materials directly without re-rendering this component (which would tear down and
    // rebuild the WebGL canvas on every tick — exactly what render-on-demand exists to avoid).
    scene.applyState(useDeviceStore.getState().latestReadings);
    const unsubscribe = useDeviceStore.subscribe((s) => scene.applyState(s.latestReadings));

    // Default-on auto-rotate (v4's behaviour) — never started at all under
    // prefers-reduced-motion, not started-then-immediately-stopped.
    if (!reducedMotion) scene.setAutoRotate(true);

    // ResizeObserver is the standards-correct way to track a container that can resize
    // independently of the window (e.g. the sidebar collapsing). It does not fire in this
    // project's headless verification pane (see officeScene.ts's header comment) — the
    // window `resize` listener below is not merely a fallback for that gap, it's also
    // needed for real browsers when only the viewport (not this container) changes size.
    const ro = new ResizeObserver(() => {
      if (containerRef.current) scene.resize(containerRef.current.clientWidth, containerRef.current.clientHeight);
    });
    ro.observe(container);
    const onWindowResize = () => scene.resize(container.clientWidth, container.clientHeight);
    window.addEventListener('resize', onWindowResize);

    // Native listener, not JSX `onWheel`: React attaches wheel/touch listeners as passive
    // by default (for scroll performance) and gives no way to opt a synthetic handler out
    // of that, so calling preventDefault() inside a JSX onWheel throws "Unable to
    // preventDefault inside passive event listener invocation" on every scroll — confirmed
    // by reproducing it directly against this exact handler before this fix. `{ passive:
    // false }` here is what actually lets scrolling over the canvas zoom it instead of
    // scrolling the page.
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      sceneRef.current?.zoom(e.deltaY < 0 ? 1.1 : 1 / 1.1);
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });

    return () => {
      unsubscribe();
      ro.disconnect();
      window.removeEventListener('resize', onWindowResize);
      canvas.removeEventListener('wheel', onWheel);
      scene.dispose();
      sceneRef.current = null;
    };
    // reducedMotion is set once by a lazy useState initializer and never changes after
    // mount (see its own comment above) — listed for exhaustive-deps, not because this
    // effect needs to react to it changing.
  }, [webgl, reducedMotion]);

  // Keeps the scene's user-placed desks/tables in sync with `layout` — the single place
  // every mutation (place, paste, delete, import, reset) funnels through, since they all
  // go through `setLayout`. Runs on mount too (picking up whatever `loadLayout()` found in
  // storage), and again on every subsequent change.
  useEffect(() => {
    sceneRef.current?.syncEditableFurniture(layout);
  }, [layout]);

  // Selection is visual-only (a ring under the picked piece) and lives on the scene, not
  // the layout data — kept as its own effect so selecting doesn't have to round-trip
  // through a full `syncEditableFurniture` diff.
  useEffect(() => {
    sceneRef.current?.setEditableSelection(selectedEditId);
  }, [selectedEditId]);

  // Escape cancels an armed "+ Desk"/"+ Table" placement without needing a second click on
  // the toolbar button.
  useEffect(() => {
    if (!placeKind) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPlaceKind(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [placeKind]);

  if (!webgl) return <FloorPlanView />;

  const toggleAutoRotate = () => {
    const next = !autoRotate;
    sceneRef.current?.setAutoRotate(next);
    setAutoRotateState(next);
  };

  const toggleEditMode = () => {
    const next = !editMode;
    setEditMode(next);
    // Each mode owns its own selection — leaving either one clears both so re-entering
    // starts clean rather than reopening a stale inspector/ring from before the switch.
    setSelectedEditId(null);
    setPlaceKind(null);
    setHover(null);
    setSelected(null);
  };

  const selectedItem = layout.find((i) => i.id === selectedEditId) ?? null;

  /** Click again to disarm — same toggle behaviour `toggleAutoRotate`'s button has, so a
   * misclick on "+ Desk" doesn't require reaching for Escape to undo. */
  const armPlace = (kind: EditableKind) => {
    setPlaceKind((cur) => (cur === kind ? null : kind));
    setSelectedEditId(null);
  };

  const copySelected = () => {
    if (!selectedItem) return;
    setClipboard({ kind: selectedItem.kind, ry: selectedItem.ry });
  };

  const pasteClipboard = () => {
    if (!clipboard) return;
    // Offsets from whatever's currently selected; falls back to the last item in the
    // layout (or the room's own centre) so Paste still does something sensible right after
    // Copy, before anything is (re-)selected.
    const from = selectedItem ?? layout[layout.length - 1] ?? { x: 0, z: 0 };
    const { x, z } = pastePosition(from);
    const item: EditableItem = { id: newItemId(), kind: clipboard.kind, x, z, ry: clipboard.ry };
    setLayout((items) => [...items, item]);
    setSelectedEditId(item.id);
  };

  const deleteSelected = () => {
    if (!selectedEditId) return;
    setLayout((items) => items.filter((i) => i.id !== selectedEditId));
    setSelectedEditId(null);
  };

  /** 45° per click (`nextRotation`) — how "pick where the furniture faces" is exposed:
   * click until it's turned the right way, rather than a drag handle or a numeric input.
   * Updates in place (same id, new `ry`) — `syncEditableFurniture` applies the new facing
   * to the already-built piece instead of removing and rebuilding it. */
  const rotateSelected = () => {
    if (!selectedItem) return;
    const id = selectedItem.id;
    setLayout((items) => items.map((i) => (i.id === id ? { ...i, ry: nextRotation(i.ry) } : i)));
  };

  const doSaveLayout = () => {
    const ok = saveLayout(layout);
    if (ok) {
      setSaveStatus({ at: Date.now(), count: layout.length });
      setLayoutError(null);
    } else {
      setSaveStatus(null);
      setLayoutError('Could not save — this browser may be blocking local storage.');
    }
  };

  const doResetLayout = () => {
    setLayout([]);
    setSelectedEditId(null);
    setPlaceKind(null);
    clearSavedLayout();
    setSaveStatus(null);
    setLayoutError(null);
  };

  /** Gated the same way Control's fleet-wide masters and Automation's context write are —
   * this wipes every placed item in one action with no undo. Skips the modal when there's
   * nothing to lose, same as `AutomationPage.tsx`'s own save button disabling itself when
   * `pendingEntries.length === 0` rather than confirming a no-op. */
  const askResetLayout = () => {
    if (layout.length === 0) {
      doResetLayout();
      return;
    }
    ask(
      {
        title: 'Reset layout?',
        body: `This removes all ${layout.length} placed item${layout.length === 1 ? '' : 's'} from this session and clears the saved layout. This can't be undone.`,
        confirmLabel: 'Reset layout',
        tone: 'red',
      },
      doResetLayout,
    );
  };

  const doExportLayout = () => {
    const blob = new Blob([JSON.stringify(layout, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = exportLayoutFilename();
    a.click();
    URL.revokeObjectURL(url);
  };

  const triggerImportLayout = () => fileInputRef.current?.click();

  /** Gated only when it would discard something — an empty floor has nothing to lose, so
   * importing into it applies immediately. */
  const applyImportedLayout = (items: EditableItem[]) => {
    setLayout(items);
    setSelectedEditId(null);
    setPlaceKind(null);
    setSaveStatus(null);
    setLayoutError(null);
  };
  const askImportLayout = (items: EditableItem[]) => {
    if (layout.length === 0) {
      applyImportedLayout(items);
      return;
    }
    ask(
      {
        title: 'Import layout?',
        body: `This replaces the ${layout.length} item${layout.length === 1 ? '' : 's'} currently placed with ${items.length} from the file. Anything not saved is lost.`,
        confirmLabel: 'Import layout',
        tone: 'blue',
      },
      () => applyImportedLayout(items),
    );
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    draggingRef.current = true;
    movedRef.current = false;
    lastPointerRef.current = { x: e.clientX, y: e.clientY };
    (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const scene = sceneRef.current;
    if (!scene) return;

    if (draggingRef.current) {
      const dx = e.clientX - lastPointerRef.current.x;
      const dy = e.clientY - lastPointerRef.current.y;
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) movedRef.current = true;
      lastPointerRef.current = { x: e.clientX, y: e.clientY };
      scene.orbit(dx * -0.006, dy * -0.006);
      setHover(null);
      return;
    }

    // No device tooltips while editing — hovering a desk isn't identifying a device, and
    // the constant raycast this would otherwise run on every mouse move is wasted work
    // while the editable-furniture pick path is what matters instead.
    if (editMode) {
      setHover(null);
      return;
    }

    const rect = e.currentTarget.getBoundingClientRect();
    const pick = scene.pick(e.clientX - rect.left, e.clientY - rect.top, rect.width, rect.height);
    const selection = pickToSelection(pick);
    setHover(selection ? { selection, x: e.clientX, y: e.clientY } : null);
  };

  /**
   * Branches once, at the top, into the two interaction modes this component ever has —
   * everything below the `editMode` check is the original, unmodified device-inspection
   * path. Edit Layout further branches on whether a placement is armed: a click either
   * drops a new desk/table at the raycasted floor point (then disarms — one placement per
   * button press, not a rubber-stamp mode) or selects/deselects an existing one.
   */
  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    draggingRef.current = false;
    if (movedRef.current) return;
    const scene = sceneRef.current;
    if (!scene) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;

    if (editMode) {
      if (placeKind) {
        const point = scene.pickFloorPoint(px, py, rect.width, rect.height);
        if (point) {
          const { x, z } = clampToRoom(point.x, point.z);
          const item: EditableItem = { id: newItemId(), kind: placeKind, x, z, ry: 0 };
          setLayout((items) => [...items, item]);
          setSelectedEditId(item.id);
        }
        setPlaceKind(null);
        return;
      }
      setSelectedEditId(scene.pickEditable(px, py, rect.width, rect.height));
      return;
    }

    const pick = scene.pick(px, py, rect.width, rect.height);
    setSelected(pickToSelection(pick));
  };

  const onImportFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // lets the same filename be picked again later
    if (!file) return;
    const parsed = parseLayoutJson(await file.text());
    if (!parsed) {
      setLayoutError('That file is not a valid iBEMS layout export.');
      return;
    }
    setLayoutError(null);
    askImportLayout(parsed);
  };

  const layoutStatus = layoutError ?? (saveStatus ? `Saved ${saveStatus.count} item${saveStatus.count === 1 ? '' : 's'} at ${new Date(saveStatus.at).toLocaleTimeString('en-PH', { hour12: false })}` : '');

  return (
    <div ref={containerRef} className="scene3d-container">
      <canvas
        ref={canvasRef}
        className="scene3d-canvas"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={() => {
          draggingRef.current = false;
          setHover(null);
        }}
      />
      <div className="scene3d-chip-row">
        <span className="scene3d-chip">{litCount}/21 LIGHTS LIT</span>
        <span className="scene3d-chip">ACU {acuState ? acuState.toUpperCase() : 'UNKNOWN'}</span>
        {placeKind && (
          <span className="scene3d-chip scene3d-chip--hint" role="status">
            Click the floor to place a {EDITABLE_LABEL[placeKind]} · Esc to cancel
          </span>
        )}
      </div>

      <div className="scene3d-controls">
        {editMode && (
          <div className="scene3d-edit-toolbar" role="toolbar" aria-label="Edit layout">
            {PLACE_TOOLS.map(({ kind, label, Icon }) => (
              <button key={kind} type="button" className="scene3d-edit-btn" aria-pressed={placeKind === kind} onClick={() => armPlace(kind)} aria-label={label} title={label}>
                <Icon size={14} aria-hidden="true" />
              </button>
            ))}
            <span className="scene3d-edit-toolbar__divider" aria-hidden="true" />
            <button type="button" className="scene3d-edit-btn" disabled={!selectedItem} onClick={copySelected} aria-label="Copy selected item" title="Copy">
              <Copy size={14} aria-hidden="true" />
            </button>
            <button type="button" className="scene3d-edit-btn" disabled={!clipboard} onClick={pasteClipboard} aria-label="Paste" title="Paste">
              <ClipboardPaste size={14} aria-hidden="true" />
            </button>
            <button type="button" className="scene3d-edit-btn" disabled={!selectedItem} onClick={rotateSelected} aria-label="Rotate selected item" title="Rotate">
              <Redo2 size={14} aria-hidden="true" />
            </button>
            <button type="button" className="scene3d-edit-btn" disabled={!selectedEditId} onClick={deleteSelected} aria-label="Delete selected item" title="Delete">
              <Trash2 size={14} aria-hidden="true" />
            </button>
            <span className="scene3d-edit-toolbar__divider" aria-hidden="true" />
            <button type="button" className="scene3d-edit-btn" disabled={layout.length === 0} onClick={doSaveLayout} aria-label="Save layout" title="Save">
              <Save size={14} aria-hidden="true" />
            </button>
            <button type="button" className="scene3d-edit-btn" disabled={layout.length === 0} onClick={askResetLayout} aria-label="Reset layout" title="Reset layout">
              <RotateCcw size={14} aria-hidden="true" />
            </button>
            <button type="button" className="scene3d-edit-btn" onClick={triggerImportLayout} aria-label="Import layout" title="Import">
              <Upload size={14} aria-hidden="true" />
            </button>
            <button type="button" className="scene3d-edit-btn" disabled={layout.length === 0} onClick={doExportLayout} aria-label="Export layout" title="Export">
              <Download size={14} aria-hidden="true" />
            </button>
            {/* Hidden file input — Import's real trigger. `aria-hidden` + `tabIndex={-1}`
                since the visible "Import" button above is the actual control; this exists
                only because a browser's file picker can't be opened except by clicking
                (a real or simulated click on) an <input type="file"> itself. */}
            <input ref={fileInputRef} type="file" accept="application/json" className="sr-only" tabIndex={-1} aria-hidden="true" onChange={(e) => void onImportFileChange(e)} />
          </div>
        )}
        {editMode && layoutStatus && (
          <p className={`scene3d-edit-status${layoutError ? ' scene3d-edit-status--error' : ''}`} role={layoutError ? 'alert' : 'status'}>
            {layoutStatus}
          </p>
        )}
        <div className="scene3d-actions-row">
          <button type="button" className="scene3d-autorotate-btn" onClick={() => sceneRef.current?.resetView()} aria-label="Reset view" title="Reset view">
            <Home size={14} aria-hidden="true" />
          </button>
          <button type="button" className="scene3d-autorotate-btn" onClick={() => sceneRef.current?.setTopDownView()} aria-label="Top-down view" title="Top-down view">
            <LayoutPanelTop size={14} aria-hidden="true" />
          </button>
          <button
            type="button"
            className={`scene3d-autorotate-btn${editMode ? ' scene3d-autorotate-btn--active' : ''}`}
            onClick={toggleEditMode}
            aria-pressed={editMode}
            aria-label={editMode ? 'Exit edit layout' : 'Edit layout'}
            title={editMode ? 'Exit edit layout' : 'Edit layout'}
          >
            <Pencil size={14} aria-hidden="true" />
          </button>
          {!reducedMotion && (
            <button
              type="button"
              className={`scene3d-autorotate-btn${autoRotate ? ' scene3d-autorotate-btn--active' : ''}`}
              onClick={toggleAutoRotate}
              aria-pressed={autoRotate}
              aria-label={autoRotate ? 'Stop auto-rotate' : 'Start auto-rotate'}
              title={autoRotate ? 'Stop auto-rotate' : 'Start auto-rotate'}
            >
              {autoRotate ? <Pause size={14} aria-hidden="true" /> : <RotateCw size={14} aria-hidden="true" />}
            </button>
          )}
        </div>
      </div>

      {hover && <SceneTooltip selection={hover.selection} x={hover.x} y={hover.y} />}
      {selected && <DeviceInspector selection={selected} onClose={() => setSelected(null)} />}
      <ConfirmModal {...modalProps} />
    </div>
  );
}

function SceneTooltip({ selection, x, y }: { selection: Selection; x: number; y: number }) {
  const device = useDeviceStore((s) => s.devices.find((d) => d.id === selection.deviceId));
  const reading = useDeviceStore((s) => s.latestReadings[selection.deviceId]);
  if (!device) return null;

  const state = selection.socket ? reading?.socket_states?.[selection.socket] : reading?.state;
  const label = selection.socket ? `${device.display_name} — Socket ${selection.socket}` : device.display_name;

  return (
    <div className="scene3d-tooltip" style={{ left: x + 14, top: y + 14 }}>
      <strong>{label}</strong>
      <span>{state ?? 'unknown'}</span>
    </div>
  );
}

function DeviceInspector({ selection, onClose }: { selection: Selection; onClose: () => void }) {
  const device = useDeviceStore((s) => s.devices.find((d) => d.id === selection.deviceId));
  const reading = useDeviceStore((s) => s.latestReadings[selection.deviceId]);
  if (!device) return null;

  const state = selection.socket ? reading?.socket_states?.[selection.socket] : reading?.state;

  return (
    <div className="scene3d-inspector">
      <Card
        title={selection.socket ? `${device.display_name} — Socket ${selection.socket}` : device.display_name}
        subtitle={device.branch_circuit}
        action={
          <button type="button" className="scene3d-inspector-close" onClick={onClose} aria-label="Close">
            <X size={14} aria-hidden="true" />
          </button>
        }
      >
        <div className="scene3d-inspector-row">
          <Badge tone={state === 'on' ? 'good' : state === 'off' ? 'neutral' : 'warn'}>{state ?? 'unknown'}</Badge>
        </div>
        <div className="scene3d-inspector-metrics">
          <div>
            <span className="metric-label">Power</span>
            <MetricValue value={reading?.power_w} unit="W" digits={0} size="sm" />
          </div>
          <div>
            <span className="metric-label">Energy today</span>
            <MetricValue value={reading?.energy_kwh_today} unit="kWh" digits={2} size="sm" />
          </div>
        </div>
      </Card>
    </div>
  );
}
