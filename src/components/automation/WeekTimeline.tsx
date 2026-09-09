import { useMemo } from 'react';
import { DAY_LABELS, DAY_NAMES } from '@shared/scheduleDays.mjs';
import { weekTimeline, formatMinute, MINUTES_PER_DAY } from '@/lib/scheduleStack';
import type { Schedule } from '@/lib/supabaseSchedules';

/**
 * What a stack actually does across a week, as seven rows of on-time.
 *
 * WHY A PICTURE EARNS ITS PLACE HERE. A list of five rules does not show that Monday has a gap
 * between 12:00 and 13:00, that two rules overlap, or that a Friday-evening ON runs all weekend
 * because the only OFF is on Monday. Those are the questions somebody opens this page with, and
 * every one of them is a property of the STACK rather than of any rule in it.
 *
 * The spans come from `weekTimeline`, which simulates the week rather than drawing one bar per
 * rule — see its docblock for why that distinction is load-bearing rather than fussy.
 *
 * Rendered as divs rather than SVG so the bars inherit the theme's tokens directly and a
 * hovered bar can carry a plain `title`; there is no axis to draw and no scale to compute
 * beyond a percentage.
 */
export function WeekTimeline({ stack, label }: { stack: Schedule[]; label: string }) {
  const timeline = useMemo(() => weekTimeline(stack), [stack]);

  const byDay = useMemo(() => {
    const rows: { day: number; spans: { startMin: number; endMin: number }[] }[] = DAY_LABELS.map((_, day) => ({ day, spans: [] }));
    for (const span of timeline.spans) rows[span.day].spans.push(span);
    return rows;
  }, [timeline]);

  if (timeline.empty) {
    return (
      <div className="week-timeline week-timeline--empty">
        <p className="week-timeline__note">
          Nothing armed yet, so there is nothing to draw. An empty week and a week of “always off” look the same, and
          only one of them would be true here.
        </p>
      </div>
    );
  }

  const totalHours = timeline.spans.reduce((sum, s) => sum + (s.endMin - s.startMin), 0) / 60;

  return (
    <div className="week-timeline">
      <div className="week-timeline__head">
        <span className="week-timeline__title">The week this stack switches on</span>
        <span className="week-timeline__total mono">{totalHours.toFixed(1)} h / week</span>
      </div>

      {timeline.neverOff && (
        <p className="week-timeline__warn" role="status">
          Every rule here switches <strong>on</strong> and none switches off, so nothing in this stack can ever turn it
          back off.
        </p>
      )}

      <div className="week-timeline__grid">
        <div className="week-timeline__hours" aria-hidden="true">
          {[0, 6, 12, 18, 24].map((h) => (
            <span key={h} className="week-timeline__hour mono" style={{ left: `${(h / 24) * 100}%` }}>
              {String(h).padStart(2, '0')}
            </span>
          ))}
        </div>

        {byDay.map(({ day, spans }) => (
          <div key={day} className="week-timeline__row">
            <span className="week-timeline__day mono" aria-hidden="true">
              {DAY_LABELS[day]}
            </span>
            <div className="week-timeline__track">
              {spans.map((span) => (
                <div
                  key={`${span.startMin}-${span.endMin}`}
                  className="week-timeline__span"
                  style={{
                    left: `${(span.startMin / MINUTES_PER_DAY) * 100}%`,
                    width: `${((span.endMin - span.startMin) / MINUTES_PER_DAY) * 100}%`,
                  }}
                  title={`${DAY_NAMES[day]} ${formatMinute(span.startMin)} – ${formatMinute(span.endMin)}`}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* The bars are decorative to assistive tech — a screen reader gets the same facts as a
          sentence per day instead, which is more useful than seven unlabelled rectangles. */}
      <p className="sr-only">
        {label}:{' '}
        {byDay
          .map(({ day, spans }) =>
            spans.length === 0
              ? `${DAY_NAMES[day]}, off all day`
              : `${DAY_NAMES[day]}, on ${spans.map((s) => `${formatMinute(s.startMin)} to ${formatMinute(s.endMin)}`).join(' and ')}`,
          )
          .join('. ')}
        .
      </p>
    </div>
  );
}
