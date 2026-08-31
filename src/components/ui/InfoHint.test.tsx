import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { InfoHint } from './InfoHint';

/**
 * The placement arithmetic is covered exhaustively in `popoverPlacement.test.ts`. What is left
 * to guard here is the part jsdom CAN see and the maths cannot: that the popover leaves its
 * container at all.
 *
 * That is not a detail. `.card` and `.top-nav` both carry `backdrop-filter`, which makes them
 * containing blocks for fixed-position descendants — so a popover rendered in place is measured
 * against the card rather than the viewport, and cards additionally clip their overflow.
 * Rendering into `document.body` is what makes the computed position mean what it says, and a
 * future refactor that "simplified" the portal away would silently reintroduce the original bug
 * with every unit test still green.
 */
describe('InfoHint', () => {
  afterEach(() => {
    // vite.config.ts sets `globals: false`, so RTL's automatic cleanup never registers.
    cleanup();
  });

  it('renders only a button until it is opened', () => {
    render(<InfoHint label="Why">the reason</InfoHint>);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    // The "~20 mounts must stay cheap" constraint: a closed hint costs one button, no portal.
    expect(document.body.querySelector('.info-hint__pop')).toBeNull();
  });

  it('portals the open popover to document.body, escaping the card that would clip it', () => {
    const { container } = render(<InfoHint label="Why">the reason</InfoHint>);
    fireEvent.click(screen.getByRole('button', { name: 'Why' }));

    const pop = screen.getByRole('tooltip');
    expect(pop).toHaveTextContent('the reason');
    expect(pop.parentElement).toBe(document.body);
    // The component's own subtree must NOT contain it — that is the whole point.
    expect(container.querySelector('.info-hint__pop')).toBeNull();
  });

  it('closes on Escape and returns focus to the trigger', () => {
    render(<InfoHint label="Why">the reason</InfoHint>);
    const btn = screen.getByRole('button', { name: 'Why' });
    fireEvent.click(btn);
    expect(screen.getByRole('tooltip')).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    // Focus must not be dropped on <body>, which would send the next Tab to the top of the page.
    expect(document.activeElement).toBe(btn);
  });

  it('stays open when the click is inside the popover itself', () => {
    // The regression the portal invites: the trigger's subtree no longer contains the popover,
    // so a naive "outside click" test would dismiss it the moment anyone tried to select the
    // text they opened it to read.
    render(<InfoHint label="Why">the reason</InfoHint>);
    fireEvent.click(screen.getByRole('button', { name: 'Why' }));
    fireEvent.mouseDown(screen.getByRole('tooltip'));
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
  });

  it('closes when the click really is outside', () => {
    render(<InfoHint label="Why">the reason</InfoHint>);
    fireEvent.click(screen.getByRole('button', { name: 'Why' }));
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('reports its open state to assistive technology', () => {
    render(<InfoHint label="Why">the reason</InfoHint>);
    const btn = screen.getByRole('button', { name: 'Why' });
    expect(btn).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(btn);
    expect(btn).toHaveAttribute('aria-expanded', 'true');
  });
});
