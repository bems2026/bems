import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import { ScheduleRow } from './ScheduleRow';
import { useContextStore } from '@/stores/contextStore';
import type { Device } from '@/lib/types';

const light = (): Device => ({
  id: 'l1', display_name: 'Light Switch 1', class: 'switch', room: null, dps_map: null, status: 'active',
});

const seed = (saved: Record<string, string>) => useContextStore.setState({ saved, draft: {} });

afterEach(() => {
  cleanup();
  useContextStore.setState({ saved: {}, draft: {}, status: 'idle', saveStatus: 'idle', saveError: null });
});

describe('ScheduleRow', () => {
  /**
   * THE DEFECT THIS ROW EXISTS TO FIX. `.automation-sched-row--head` is `display: none` below
   * 720px, so on the CARE kiosk and on any phone the ON and OFF column captions are gone and the
   * two `type="time"` inputs are visually identical. The only thing telling them apart was an
   * `aria-label`, which a sighted operator never hears. Setting the lights' ON time into the OFF
   * field is a silent, plausible mistake that fires at the wrong hour.
   */
  it('labels each clock in the row itself, not only in a column header that disappears on a phone', () => {
    seed({ 'global.schedule.l1.on': '07:00', 'global.schedule.l1.off': '18:00' });
    const { container } = render(<ScheduleRow device={light()} />);

    const onField = container.querySelector('.automation-time-field--on') as HTMLElement;
    const offField = container.querySelector('.automation-time-field--off') as HTMLElement;
    expect(onField).toBeInTheDocument();
    expect(offField).toBeInTheDocument();
    expect(within(onField).getByText('ON')).toBeInTheDocument();
    expect(within(offField).getByText('OFF')).toBeInTheDocument();
  });

  it('keeps each input accessibly named, so the visible caption is not the only channel', () => {
    seed({});
    render(<ScheduleRow device={light()} />);
    expect(screen.getByLabelText('Light Switch 1 on time')).toBeInTheDocument();
    expect(screen.getByLabelText('Light Switch 1 off time')).toBeInTheDocument();
  });

  it('warns inline when a row is armed with no day selected, because it can never fire', () => {
    seed({ 'global.schedule.l1.armed': 'true', 'global.schedule.l1.on': '07:00', 'global.schedule.l1.days': '0000000' });
    const { container } = render(<ScheduleRow device={light()} />);
    expect(container.querySelector('.automation-sched-row__problem')).toHaveTextContent(/never run/i);
  });

  it('warns when a row is armed with no ON time', () => {
    seed({ 'global.schedule.l1.armed': 'true', 'global.schedule.l1.days': '1111100' });
    const { container } = render(<ScheduleRow device={light()} />);
    expect(container.querySelector('.automation-sched-row__problem')).toHaveTextContent(/nothing to schedule/i);
  });

  /**
   * "Arm all" can turn a dozen rows into warning rows in one click. As live regions that was a
   * dozen simultaneous announcements; the note is now the arm switch's own description instead,
   * and the count is announced once by the page.
   */
  it('describes the arm switch with the reason, rather than announcing it as a live region', () => {
    seed({ 'global.schedule.l1.armed': 'true', 'global.schedule.l1.days': '0000000' });
    const { container } = render(<ScheduleRow device={light()} />);
    const note = container.querySelector('.automation-sched-row__problem') as HTMLElement;
    const arm = screen.getByRole('switch');
    expect(note).not.toHaveAttribute('role', 'status');
    expect(arm).toHaveAttribute('aria-describedby', note.id);
  });

  it('leaves the arm switch undescribed when there is nothing wrong', () => {
    seed({ 'global.schedule.l1.armed': 'true', 'global.schedule.l1.on': '07:00', 'global.schedule.l1.days': '1111100' });
    render(<ScheduleRow device={light()} />);
    expect(screen.getByRole('switch')).not.toHaveAttribute('aria-describedby');
  });

  it('says nothing at all about a healthy schedule', () => {
    seed({
      'global.schedule.l1.armed': 'true',
      'global.schedule.l1.on': '07:00',
      'global.schedule.l1.off': '18:00',
      'global.schedule.l1.days': '1111100',
    });
    render(<ScheduleRow device={light()} />);
    expect(document.querySelector('.automation-sched-row__problem')).not.toBeInTheDocument();
  });

  it('says nothing about an overnight schedule, which is a real configuration and not a fault', () => {
    seed({
      'global.schedule.l1.armed': 'true',
      'global.schedule.l1.on': '18:00',
      'global.schedule.l1.off': '06:00',
      'global.schedule.l1.days': '1111111',
    });
    render(<ScheduleRow device={light()} />);
    expect(document.querySelector('.automation-sched-row__problem')).not.toBeInTheDocument();
  });

  it('says nothing about an unarmed, half-filled row — that is a draft', () => {
    seed({ 'global.schedule.l1.on': '07:00' });
    render(<ScheduleRow device={light()} />);
    expect(document.querySelector('.automation-sched-row__problem')).not.toBeInTheDocument();
  });
});
