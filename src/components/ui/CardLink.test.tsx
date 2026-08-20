import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { CardLink } from './CardLink';

afterEach(() => {
  cleanup();
  window.location.hash = '';
});

describe('CardLink', () => {
  it('exposes an accessible name even though it shows no text — an icon-only button without one is unusable by screen reader', () => {
    render(<CardLink to="analytics" label="View energy details" />);
    expect(screen.getByRole('button', { name: 'View energy details' })).toBeInTheDocument();
  });

  it('renders no visible text, which is the whole point of the change', () => {
    const { container } = render(<CardLink to="analytics" label="View energy details" />);
    expect(container.textContent).toBe('');
  });

  it('carries a title so pointer users get the same label on hover', () => {
    render(<CardLink to="devices" label="Open fleet status" />);
    expect(screen.getByRole('button', { name: 'Open fleet status' })).toHaveAttribute('title', 'Open fleet status');
  });

  it('navigates to the target route on click', () => {
    render(<CardLink to="automation" label="Open automation" />);
    fireEvent.click(screen.getByRole('button', { name: 'Open automation' }));
    expect(window.location.hash).toBe('#automation');
  });

  it('is a real button, so it is keyboard reachable and activates on Enter/Space without extra wiring', () => {
    render(<CardLink to="control" label="Open controls" />);
    expect(screen.getByRole('button', { name: 'Open controls' })).toHaveProperty('tagName', 'BUTTON');
  });
});
