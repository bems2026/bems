import type { ReactNode } from 'react';
import { useDeviceStore } from '@/stores/deviceStore';
import { isReadingStale } from '@/lib/staleness';
import type { Reading } from '@/lib/types';

/**
 * Read-only 2D floor plan. Geometry ported from the live Node-RED dashboard's two
 * `ui_template` nodes — `Lighting Floor Plan` (id `8a84d5fec547c73f`) and `Outlet Floor
 * Plan (Status Only)` (id `a8e6460facb3860c`) — same 320×550 viewBox, same fixed
 * coordinates, rewritten from AngularJS `ng-repeat` + `sessionStorage` caching to React
 * reading `deviceStore` directly. Retiring that per-tab `sessionStorage` cache (every
 * browser tab drifting out of sync until the next full broadcast) is a named goal of the
 * architecture doc — this component is that fix, not a cosmetic port.
 *
 * `LIGHT_LAYOUT`/`OUTLET_LAYOUT` are keyed by device id (`l1..l7`, `co1..co7`), and every
 * lookup below reads `readings[id]` — never `readings[index]` or an array position. The
 * legacy Angular version bound positionally (`coords[i-1]`), which is exactly the kind of
 * thing that silently shifts a light to the wrong grid cell the moment the device list
 * changes order — the failure mode the onboarding wizard (Phase 4.5) will introduce once
 * devices stop being a fixed, hand-authored list of 14.
 *
 * No click handlers anywhere — Stage 1 is view-only. Each cell already takes its state
 * as a plain read value with nothing wired to `onClick`, so Stage 2 can add interaction
 * without restructuring this SVG.
 */

const VIEWBOX = '0 0 320 550';

const LIGHT_LAYOUT: { id: string; row: number }[] = [1, 2, 3, 4, 5, 6, 7].map((row) => ({
  id: `l${row}`,
  row,
}));

/** Same order as the live template's `coords` array — index i-1 is device `co{i}`. */
const OUTLET_LAYOUT: { id: string; x: number; y: number }[] = [
  { id: 'co1', x: 25, y: 470 },
  { id: 'co2', x: 50, y: 515 },
  { id: 'co3', x: 285, y: 470 },
  { id: 'co4', x: 25, y: 370 },
  { id: 'co5', x: 65, y: 115 },
  { id: 'co6', x: 235, y: 115 },
  { id: 'co7', x: 285, y: 190 },
];

export function FloorPlanView() {
  const readings = useDeviceStore((s) => s.latestReadings);

  return (
    <div className="floorplan-grid">
      <LightingPlan readings={readings} />
      <OutletPlan readings={readings} />
    </div>
  );
}

function PlanFrame({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="floorplan-card">
      <h3 className="floorplan-title">{title}</h3>
      <svg viewBox={VIEWBOX} className="floorplan-svg" role="img" aria-label={title}>
        <rect x={10} y={10} width={300} height={530} fill="none" stroke="var(--border)" strokeWidth={2} rx={5} />
        <line x1={10} y1={100} x2={310} y2={100} stroke="var(--border)" strokeWidth={2} />
        {children}
      </svg>
    </div>
  );
}

function LightingPlan({ readings }: { readings: Record<string, Reading> }) {
  return (
    <PlanFrame title="Lighting (L1–L7)">
      {LIGHT_LAYOUT.map(({ id, row }) => {
        const reading = readings[id];
        const stale = isReadingStale(reading);
        const on = reading?.state === 'on';
        const fill = stale ? 'var(--muted-2)' : on ? 'var(--accent)' : 'var(--bg-surface-2)';
        const y = 480 - (row - 1) * 65;
        return (
          <g key={id}>
            {[0, 1, 2].map((col) => (
              <rect
                key={col}
                x={50 + col * 100}
                y={y}
                width={18}
                height={18}
                rx={2}
                fill={fill}
                stroke="var(--border-strong)"
                opacity={stale ? 0.5 : 1}
              />
            ))}
            <text x={285} y={y + 14} fill="var(--muted)" fontSize={12} fontWeight={700}>
              L{row}
            </text>
          </g>
        );
      })}
    </PlanFrame>
  );
}

function OutletPlan({ readings }: { readings: Record<string, Reading> }) {
  return (
    <PlanFrame title="Convenience Outlets (CO1–CO7)">
      {OUTLET_LAYOUT.map(({ id, x, y }, i) => {
        const reading = readings[id];
        const stale = isReadingStale(reading);
        const s1 = reading?.socket_states?.[1] === 'on';
        const s2 = reading?.socket_states?.[2] === 'on';
        const num = i + 1;
        return (
          <g key={id}>
            <path
              d={`M ${x} ${y - 12} A 12 12 0 0 0 ${x} ${y + 12} Z`}
              fill={stale ? 'var(--muted-2)' : s1 ? 'var(--accent)' : 'var(--bg-inset)'}
              stroke="var(--accent)"
              strokeWidth={1.5}
              opacity={stale ? 0.5 : 1}
            />
            <path
              d={`M ${x} ${y - 12} A 12 12 0 0 1 ${x} ${y + 12} Z`}
              fill={stale ? 'var(--muted-2)' : s2 ? 'var(--accent)' : 'var(--bg-inset)'}
              stroke="var(--accent)"
              strokeWidth={1.5}
              opacity={stale ? 0.5 : 1}
            />
            <text
              x={x - 18}
              y={y + 3}
              fontSize={8}
              fontWeight={900}
              textAnchor="middle"
              fill={stale ? 'var(--muted)' : s1 ? 'var(--good)' : 'var(--bad)'}
            >
              {stale ? '?' : s1 ? 'ON' : 'OFF'}
            </text>
            <text
              x={x + 18}
              y={y + 3}
              fontSize={8}
              fontWeight={900}
              textAnchor="middle"
              fill={stale ? 'var(--muted)' : s2 ? 'var(--good)' : 'var(--bad)'}
            >
              {stale ? '?' : s2 ? 'ON' : 'OFF'}
            </text>
            <text x={x} y={y - 18} fontSize={10} fontWeight={700} textAnchor="middle" fill="var(--muted)">
              CO{num}
            </text>
          </g>
        );
      })}
    </PlanFrame>
  );
}
