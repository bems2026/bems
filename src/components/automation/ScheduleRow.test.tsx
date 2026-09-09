import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, within, fireEvent } from '@testing-library/react';
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

  /**
   * THERE WAS NO WAY TO GET RID OF A SCHEDULE. Live on 2026-09-08 the table held seven rows, none
   * enabled, several of them junk — `l6` was on 16:23 / off 16:22 with no day selected. You could
   * blank each field by hand; nothing offered to do it in one go.
   *
   * Clearing STAGES the blanks rather than deleting the row, deliberately: a row of empty fields
   * with `armed` off is already exactly what "no schedule" means to `server/scheduler.mjs`, and
   * going through the page's own Save gate keeps the change attributable and reversible before it
   * is written. It also needs no new delete path against the settings store.
   */
  describe('clearing', () => {
    it('offers nothing to clear on a row that is already empty', () => {
      seed({});
      render(<ScheduleRow device={light()} />);
      expect(screen.queryByRole('button', { name: /clear/i })).not.toBeInTheDocument();
    });

    it('offers to clear a row that has something in it', () => {
      seed({ 'global.schedule.l1.on': '07:00' });
      render(<ScheduleRow device={light()} />);
      expect(screen.getByRole('button', { name: /clear .*Light Switch 1/i })).toBeInTheDocument();
    });

    it('stages every field blank, so one Save removes the whole rule', () => {
      seed({
        'global.schedule.l1.on': '07:00',
        'global.schedule.l1.off': '18:00',
        'global.schedule.l1.days': '1111100',
        'global.schedule.l1.armed': 'true',
      });
      render(<ScheduleRow device={light()} />);
      fireEvent.click(screen.getByRole('button', { name: /clear/i }));

      const d = useContextStore.getState().draft;
      expect(d['global.schedule.l1.on']).toBe('');
      expect(d['global.schedule.l1.off']).toBe('');
      expect(d['global.schedule.l1.days']).toBe('0000000');
      expect(d['global.schedule.l1.armed']).toBe('false');
    });

    it('disarms as part of clearing, so a blank rule cannot stay armed', () => {
      seed({ 'global.schedule.l1.armed': 'true', 'global.schedule.l1.on': '07:00', 'global.schedule.l1.days': '1111100' });
      render(<ScheduleRow device={light()} />);
      fireEvent.click(screen.getByRole('button', { name: /clear/i }));
      expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
      // and therefore raises no "armed with nothing set" warning
      expect(document.querySelector('.automation-sched-row__problem')).not.toBeInTheDocument();
    });
  });

});
