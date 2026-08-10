interface SkeletonProps {
  /** CSS height, e.g. `'20px'` or `'100%'`. */
  height?: string;
  width?: string;
  className?: string;
}

/**
 * A loading placeholder block. Use only for the genuine pre-catalogue state
 * (`devices.length === 0`) — never for a device that *has* loaded but has no reading yet.
 * That second case is a real, meaningful fact ("—", per `MetricValue`), and skeletoning it
 * would erase the distinction the rest of this app deliberately maintains between "no data
 * arrived yet" and "still loading".
 *
 * Static, not shimmering — `prefers-reduced-motion` is already neutralised globally
 * (`index.css`), and a loading indicator needs to stay visibly present either way, just
 * without the animated sheen for users who've asked to avoid motion.
 */
export function Skeleton({ height = '1em', width = '100%', className }: SkeletonProps) {
  return (
    <span
      className={`skeleton${className ? ` ${className}` : ''}`}
      style={{ height, width }}
      role="presentation"
      aria-hidden="true"
    />
  );
}
