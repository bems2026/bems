import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, screen } from '@testing-library/react';
import { PageHeader } from './PageHeader';

afterEach(() => {
  cleanup();
});

describe('PageHeader', () => {
  it('renders the title as an h1', () => {
    render(<PageHeader title="Fleet Status" />);
    expect(screen.getByRole('heading', { level: 1, name: 'Fleet Status' })).toBeInTheDocument();
  });

  it('omits .page-sub and .page-header__actions when sub/actions are not passed', () => {
    const { container } = render(<PageHeader title="Fleet Status" />);
    expect(container.querySelector('.page-sub')).toBeNull();
    expect(container.querySelector('.page-header__actions')).toBeNull();
  });

  it('renders sub and actions as arbitrary nodes, not just strings', () => {
    render(<PageHeader title="Analytics" sub={<span data-testid="sub-node">custom sub</span>} actions={<button type="button">Do the thing</button>} />);
    expect(screen.getByTestId('sub-node')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Do the thing' })).toBeInTheDocument();
  });
});
