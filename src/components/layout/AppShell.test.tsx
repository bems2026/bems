import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { AppShell } from './AppShell';

afterEach(() => {
  cleanup();
});

describe('AppShell skip link', () => {
  it('is the first focusable element in the DOM', () => {
    render(
      <AppShell activeId="overview">
        <div>content</div>
      </AppShell>,
    );
    const focusable = document.querySelectorAll<HTMLElement>('a[href], button');
    expect(focusable[0]).toHaveClass('skip-link');
  });

  it('points at the #main-content landmark, which is programmatically focusable', () => {
    render(
      <AppShell activeId="overview">
        <div>content</div>
      </AppShell>,
    );
    const skipLink = document.querySelector('.skip-link');
    expect(skipLink).toHaveAttribute('href', '#main-content');

    const main = document.getElementById('main-content');
    expect(main?.tagName).toBe('MAIN');
    expect(main).toHaveAttribute('tabIndex', '-1');
  });
});
