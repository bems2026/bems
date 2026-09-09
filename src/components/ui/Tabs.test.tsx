import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { useState } from 'react';
import { Tabs, TabPanel } from './Tabs';

/**
 * `role="tab"` is a PROMISE ABOUT THE KEYBOARD, and this suite is what holds it. The two
 * tablists that predate this component (`DeviceCard`'s channel switcher, inline) make the
 * promise and keep none of it — arrows do nothing and every tab is its own Tab stop. These
 * assertions are the difference.
 */

const TABS = [
  { id: 'a', label: 'Alpha' },
  { id: 'b', label: 'Beta' },
  { id: 'c', label: 'Gamma' },
];

function Harness({ initial = 'a', onChange }: { initial?: string; onChange?: (id: string) => void }) {
  const [active, setActive] = useState(initial);
  return (
    <>
      <Tabs
        tabs={TABS}
        activeId={active}
        onChange={(id) => {
          setActive(id);
          onChange?.(id);
        }}
        label="Test strategies"
      />
      {TABS.map((t) => (
        <TabPanel key={t.id} tabId={t.id} activeId={active}>
          <p>{t.label} panel</p>
        </TabPanel>
      ))}
    </>
  );
}

afterEach(cleanup);

describe('Tabs', () => {
  it('names the tablist, so it is not an unnamed region to a screen reader', () => {
    render(<Harness />);
    expect(screen.getByRole('tablist', { name: 'Test strategies' })).toBeInTheDocument();
  });

  it('marks exactly one tab selected and shows only its panel', () => {
    render(<Harness />);
    const tabs = screen.getAllByRole('tab');
    expect(tabs.filter((t) => t.getAttribute('aria-selected') === 'true')).toHaveLength(1);
    expect(screen.getByText('Alpha panel')).toBeInTheDocument();
    expect(screen.queryByText('Beta panel')).not.toBeInTheDocument();
  });

  it('wires each tab to its panel in both directions', () => {
    render(<Harness />);
    const selected = screen.getByRole('tab', { selected: true });
    const panel = screen.getByRole('tabpanel');
    expect(selected.getAttribute('aria-controls')).toBe(panel.id);
    expect(panel.getAttribute('aria-labelledby')).toBe(selected.id);
  });

  it('uses a roving tabindex — a three-tab strip is ONE tab stop, not three', () => {
    // Without this, walking past a tablist costs a keyboard user one Tab press per tab and
    // the Tab key stops meaning "next region".
    render(<Harness />);
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((t) => t.getAttribute('tabindex'))).toEqual(['0', '-1', '-1']);
  });

  it('moves selection with ArrowRight and wraps at the end', () => {
    render(<Harness />);
    screen.getByRole('tab', { name: 'Alpha' }).focus();
    fireEvent.keyDown(document.activeElement as Element, { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { selected: true })).toHaveTextContent('Beta');
    fireEvent.keyDown(document.activeElement as Element, { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { selected: true })).toHaveTextContent('Gamma');
    fireEvent.keyDown(document.activeElement as Element, { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { selected: true })).toHaveTextContent('Alpha');
  });

  it('moves selection with ArrowLeft and wraps at the start', () => {
    render(<Harness />);
    screen.getByRole('tab', { name: 'Alpha' }).focus();
    fireEvent.keyDown(document.activeElement as Element, { key: 'ArrowLeft' });
    expect(screen.getByRole('tab', { selected: true })).toHaveTextContent('Gamma');
  });

  it('Home and End jump to the ends', () => {
    render(<Harness initial="b" />);
    screen.getByRole('tab', { name: 'Beta' }).focus();
    fireEvent.keyDown(document.activeElement as Element, { key: 'End' });
    expect(screen.getByRole('tab', { selected: true })).toHaveTextContent('Gamma');
    fireEvent.keyDown(document.activeElement as Element, { key: 'Home' });
    expect(screen.getByRole('tab', { selected: true })).toHaveTextContent('Alpha');
  });

  it('moves FOCUS along with selection, so the next Tab press lands in the new panel', () => {
    render(<Harness />);
    screen.getByRole('tab', { name: 'Alpha' }).focus();
    fireEvent.keyDown(document.activeElement as Element, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Beta' }));
  });

  it('does not swallow Tab — an unconditional preventDefault would trap the keyboard here', () => {
    // jsdom does not move focus for a synthetic Tab, so the observable fact is whether the
    // handler cancelled the event. Cancelling Tab is exactly what would trap a keyboard user
    // inside the tablist, and an early `e.preventDefault()` before the switch would do it.
    render(<Harness />);
    const alpha = screen.getByRole('tab', { name: 'Alpha' });
    alpha.focus();
    expect(fireEvent.keyDown(alpha, { key: 'Tab' })).toBe(true);
    expect(fireEvent.keyDown(alpha, { key: 'ArrowRight' })).toBe(false);
  });

  it('the panel is focusable, so content with no focusable element is still reachable', () => {
    render(<Harness />);
    expect(screen.getByRole('tabpanel')).toHaveAttribute('tabindex', '0');
  });

  it('reports the clicked tab to the caller', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Gamma' }));
    expect(onChange).toHaveBeenCalledWith('c');
  });

  it('renders a badge without putting it in the tab accessible name', () => {
    render(
      <Tabs tabs={[{ id: 'a', label: 'Alpha', badge: 7 }]} activeId="a" onChange={() => {}} label="L" />,
    );
    // The badge is visible...
    expect(screen.getByText('7')).toBeInTheDocument();
    // ...but "Alpha" still finds the tab, so the count does not become part of its name.
    expect(screen.getByRole('tab', { name: /Alpha/ })).toBeInTheDocument();
  });
});
