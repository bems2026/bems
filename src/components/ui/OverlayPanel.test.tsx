import { describe, it, expect, afterEach, vi } from 'vitest';
import { useState } from 'react';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { OverlayPanel } from './OverlayPanel';

afterEach(cleanup);

describe('OverlayPanel', () => {
  it('is a modal dialog named by its own heading', () => {
    render(
      <OverlayPanel title="Edit metadata — Outlet 1" onClose={vi.fn()}>
        <p>body</p>
      </OverlayPanel>,
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAccessibleName('Edit metadata — Outlet 1');
  });

  /**
   * The whole point of the primitive. `.card` and `.top-nav` carry `backdrop-filter`, which makes
   * them containing blocks for `position: fixed` descendants — so a panel rendered inside one is
   * positioned against the card rather than the viewport, and clipped by its `overflow`. EX-143
   * found every popover in the app off screen for exactly this reason.
   */
  it('portals to the body rather than rendering inside its parent card', () => {
    render(
      <div className="card" data-testid="host">
        <OverlayPanel title="Details" onClose={vi.fn()}>
          <p>body</p>
        </OverlayPanel>
      </div>,
    );
    const host = screen.getByTestId('host');
    const dialog = screen.getByRole('dialog');
    expect(host.contains(dialog)).toBe(false);
    expect(document.body.contains(dialog)).toBe(true);
  });

  it('closes on Escape', () => {
    const onClose = vi.fn();
    render(<OverlayPanel title="Details" onClose={onClose}><p>body</p></OverlayPanel>);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  /**
   * The nesting rule. A save confirmation opens INSIDE this panel and is itself an `aria-modal`
   * alertdialog with its own Escape handler. Without this, one keypress dismisses both — the
   * operator loses the confirmation and the form underneath it in a single stroke.
   *
   * Detected from the DOM rather than declared by a prop: the panel can SEE a nested dialog, so
   * asking every caller to remember to tell it was a rule three components had to re-implement
   * (and `DevicePanel` would have had to plumb up through three children to satisfy).
   */
  it('yields Escape to a nested dialog rendered inside it, with no prop to set', () => {
    const onClose = vi.fn();
    render(
      <OverlayPanel title="Details" onClose={onClose}>
        <div role="alertdialog" aria-modal="true" aria-label="Confirm">are you sure?</div>
      </OverlayPanel>,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('takes Escape back once the nested dialog goes away', () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <OverlayPanel title="Details" onClose={onClose}>
        <div role="alertdialog" aria-modal="true" aria-label="Confirm">are you sure?</div>
      </OverlayPanel>,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();

    rerender(<OverlayPanel title="Details" onClose={onClose}><p>body</p></OverlayPanel>);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  /**
   * The trap collects real tab stops, not every button. A roving-tabindex tablist (see
   * `DevicePanel`) parks its inactive tabs at `tabindex="-1"`, and a disabled button is not
   * focusable either — counting those made the trap's "first" element something Tab can never
   * reach, so Shift+Tab from the real first control went nowhere.
   */
  it('skips tabindex=-1 and disabled controls when cycling', () => {
    render(
      <OverlayPanel title="Details" onClose={vi.fn()}>
        <button type="button">real</button>
        {/* Both AFTER the real control on purpose: as the last elements they become the trap's
            boundary, which is the only position where counting them actually breaks Tab. */}
        <button type="button" tabIndex={-1}>roving</button>
        <button type="button" disabled>disabled</button>
      </OverlayPanel>,
    );
    const close = screen.getByRole('button', { name: 'Close' });
    const real = screen.getByRole('button', { name: 'real' });
    real.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(close).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(real).toHaveFocus();
  });

  it('closes on a click outside the panel, but not on one inside it', () => {
    const onClose = vi.fn();
    render(
      <OverlayPanel title="Details" onClose={onClose}>
        <button type="button">inside</button>
      </OverlayPanel>,
    );
    fireEvent.mouseDown(screen.getByRole('button', { name: 'inside' }));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.mouseDown(screen.getByTestId('overlay-panel-backdrop'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('offers a Close control wired to onClose', () => {
    const onClose = vi.fn();
    render(<OverlayPanel title="Details" onClose={onClose}><p>body</p></OverlayPanel>);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('moves focus to its heading on open', () => {
    render(<OverlayPanel title="Details" onClose={vi.fn()}><p>body</p></OverlayPanel>);
    expect(screen.getByRole('heading', { name: 'Details' })).toHaveFocus();
  });

  it('locks page scroll while open and restores the previous value on close', () => {
    document.body.style.overflow = 'scroll';
    const { unmount } = render(<OverlayPanel title="Details" onClose={vi.fn()}><p>body</p></OverlayPanel>);
    expect(document.body.style.overflow).toBe('hidden');
    unmount();
    expect(document.body.style.overflow).toBe('scroll');
    document.body.style.overflow = '';
  });

  it('returns focus to whatever opened it', () => {
    function Host() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>Open</button>
          {open && <OverlayPanel title="Details" onClose={() => setOpen(false)}><p>body</p></OverlayPanel>}
        </>
      );
    }
    render(<Host />);
    const trigger = screen.getByRole('button', { name: 'Open' });
    trigger.focus();
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(trigger).toHaveFocus();
  });

  it('cycles Tab inside the dialog rather than letting it escape to the page behind', () => {
    render(
      <OverlayPanel title="Details" onClose={vi.fn()}>
        <button type="button">last</button>
      </OverlayPanel>,
    );
    const last = screen.getByRole('button', { name: 'last' });
    const close = screen.getByRole('button', { name: 'Close' });
    last.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(close).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(last).toHaveFocus();
  });
});
