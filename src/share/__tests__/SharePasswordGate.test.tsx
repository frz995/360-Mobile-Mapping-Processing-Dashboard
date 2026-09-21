import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SharePasswordGate } from '../SharePasswordGate';

describe('SharePasswordGate', () => {
  it('renders the branded password prompt', () => {
    render(<SharePasswordGate shareTitle="Survey Map" onUnlock={async () => true} />);
    expect(screen.getByText('This shared map has a password')).toBeInTheDocument();
    expect(screen.getByText(/Survey Map/)).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Type password')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Continue/i })).toBeDisabled();
  });

  it('submits the entered password and surfaces errors when rejected', async () => {
    const onUnlock = vi.fn(async (pw: string) => pw === 'correct');
    render(<SharePasswordGate onUnlock={onUnlock} />);

    fireEvent.change(screen.getByPlaceholderText('Type password'), { target: { value: 'wrong' } });
    fireEvent.click(screen.getByRole('button', { name: /Continue/i }));

    await waitFor(() => expect(onUnlock).toHaveBeenCalledWith('wrong'));
    await waitFor(() =>
      expect(screen.getByText('Incorrect password. Please try again.')).toBeInTheDocument()
    );

    fireEvent.change(screen.getByPlaceholderText('Type password'), { target: { value: 'correct' } });
    fireEvent.click(screen.getByRole('button', { name: /Continue/i }));
    await waitFor(() => expect(onUnlock).toHaveBeenLastCalledWith('correct'));
  });
});
