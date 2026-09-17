import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { PillGroup } from './PillGroup';

const OPTIONS = [
  { value: 'cool', label: 'Cool' },
  { value: 'dry', label: 'Dry' },
] as const;

// vite.config.ts sets `globals: false`, so RTL's automatic cleanup never registers.
afterEach(cleanup);

describe('PillGroup', () => {
  it('is a labelled group of toggle buttons with exactly one pressed', () => {
    render(<PillGroup label="Mode" options={[...OPTIONS]} value="dry" onChange={() => {}} />);
    const group = screen.getByRole('group', { name: 'Mode' });
    expect(group).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Dry' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Cool' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('reports the chosen value', () => {
    const onChange = vi.fn();
    render(<PillGroup label="Mode" options={[...OPTIONS]} value="cool" onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Dry' }));
    expect(onChange).toHaveBeenCalledWith('dry');
  });

  it('disables every pill together', () => {
    render(<PillGroup label="Mode" options={[...OPTIONS]} value="cool" onChange={() => {}} disabled />);
    for (const b of screen.getAllByRole('button')) expect(b).toBeDisabled();
  });
});
