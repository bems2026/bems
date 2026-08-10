import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { Skeleton } from './Skeleton';

describe('Skeleton', () => {
  it('renders as a presentational, screen-reader-hidden placeholder', () => {
    const { container } = render(<Skeleton />);
    const el = container.querySelector('.skeleton');
    expect(el).toBeInTheDocument();
    expect(el).toHaveAttribute('aria-hidden', 'true');
    expect(el).toHaveAttribute('role', 'presentation');
  });

  it('applies the requested height and width', () => {
    const { container } = render(<Skeleton height="24px" width="60%" />);
    const el = container.querySelector('.skeleton') as HTMLElement;
    expect(el.style.height).toBe('24px');
    expect(el.style.width).toBe('60%');
  });
});
