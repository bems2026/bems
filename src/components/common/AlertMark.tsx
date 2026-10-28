import { AlertTriangle } from 'lucide-react';
import { useAlertsPanelStore } from '@/stores/alertsPanelStore';

/**
 * A card's pointer to a notice the alerts bell carries — RM-165. The energy cards printed their notices as
 * paragraphs (two measurements disagreeing, a branch short of its own power), which pushed the Overview's layout
 * about; they now carry this mark, an icon the width of a letter, with the whole notice on hover. With `inBell` it
 * opens the bell; a notice the bell does not carry (a week's or a month's) is said in its accessible name instead.
 */
export function AlertMark({ headline, detail, inBell = true }: { headline: string; detail: string; inBell?: boolean }) {
  const setOpen = useAlertsPanelStore((s) => s.setOpen);
  const full = `${headline} ${detail}`;
  if (!inBell) {
    return (
      <span className="held-tag energy-check-mark" role="img" title={full} aria-label={full}>
        <AlertTriangle size={12} aria-hidden="true" />
      </span>
    );
  }
  return (
    <button type="button" className="held-tag energy-check-mark" title={full} aria-label={`${headline} Open alerts for the details.`} onClick={() => setOpen(true)}>
      <AlertTriangle size={12} aria-hidden="true" />
    </button>
  );
}
