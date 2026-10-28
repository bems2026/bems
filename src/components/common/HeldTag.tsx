import { AlertTriangle } from 'lucide-react';
import { frozenHeadline, type FrozenBranch } from '@/lib/branchEnergy';
import { useAlertsPanelStore } from '@/stores/alertsPanelStore';

/**
 * A branch row's mark for a held reading — RM-165. The notice itself lives in the alerts bell: as paragraphs
 * inside the energy cards, eight of them on 2026-10-28 (three for one meter), they pushed the Overview's layout
 * about. An icon the width of a letter, so the row keeps its columns; the headline on hover, the bell on a press.
 */
export function HeldTag({ hold }: { hold: FrozenBranch }) {
  const setOpen = useAlertsPanelStore((s) => s.setOpen);
  const headline = frozenHeadline(hold);
  return (
    <button
      type="button"
      className="held-tag"
      title={headline}
      aria-label={`${headline} Open alerts for the details.`}
      onClick={() => setOpen(true)}
    >
      <AlertTriangle size={12} aria-hidden="true" />
      <span className="sr-only">{hold.ongoing ? 'held' : 'was held'}</span>
    </button>
  );
}
