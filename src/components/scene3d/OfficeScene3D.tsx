import { useEffect, useRef, useState } from 'react';
import { OfficeScene, type PickResult } from './officeScene';
import { FloorPlanView } from '@/components/floorplan/FloorPlanView';
import { useDeviceStore } from '@/stores/deviceStore';
import { Card } from '@/components/ui/Card';
import { MetricValue } from '@/components/ui/MetricValue';
import { Badge } from '@/components/ui/Badge';

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
 * View-only: hover shows a tooltip, click opens a read-only inspector card. Neither calls
 * anything that writes — the hit-testing here is what Stage 2 will eventually wire a
 * toggle onto, not something this component does itself.
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
  }, [webgl]);

  if (!webgl) return <FloorPlanView />;

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

    const rect = e.currentTarget.getBoundingClientRect();
    const pick = scene.pick(e.clientX - rect.left, e.clientY - rect.top, rect.width, rect.height);
    const selection = pickToSelection(pick);
    setHover(selection ? { selection, x: e.clientX, y: e.clientY } : null);
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    draggingRef.current = false;
    if (!movedRef.current) {
      const scene = sceneRef.current;
      if (scene) {
        const rect = e.currentTarget.getBoundingClientRect();
        const pick = scene.pick(e.clientX - rect.left, e.clientY - rect.top, rect.width, rect.height);
        setSelected(pickToSelection(pick));
      }
    }
  };

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
      {hover && <SceneTooltip selection={hover.selection} x={hover.x} y={hover.y} />}
      {selected && <DeviceInspector selection={selected} onClose={() => setSelected(null)} />}
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
            ✕
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
