import type { ReactNode } from 'react';

export type BadgeTone = 'neutral' | 'good' | 'warn' | 'bad' | 'accent';

interface BadgeProps {
  children: ReactNode;
  tone?: BadgeTone;
  /** Leading status dot, for live/connected-style indicators. */
  dot?: boolean;
}

const TONE_CLASS: Record<BadgeTone, string> = {
  neutral: '',
  good: ' badge--good',
  warn: ' badge--warn',
  bad: ' badge--bad',
  accent: ' badge--accent',
};

/** Small status pill — device state, live indicators, deltas. */
export function Badge({ children, tone = 'neutral', dot }: BadgeProps) {
  return (
    <span className={`badge${TONE_CLASS[tone]}`}>
      {dot && <span className="badge__dot" aria-hidden="true" />}
      {children}
    </span>
  );
}
