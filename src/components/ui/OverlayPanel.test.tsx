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
   */
  it('yields Escape to a nested dialog while blockEscape is set', () => {
    const onClose = vi.fn();
    render(<OverlayPanel title="Details" onClose={onClose} blockEscape><p>body</p></OverlayPanel>);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
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
