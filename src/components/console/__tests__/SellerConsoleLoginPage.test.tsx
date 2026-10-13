import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SellerConsoleLoginPage } from '../SellerConsoleLoginPage';
import { supabase } from '../../../services/api/client';

// Mock Supabase client
vi.mock('../../../services/api/client', () => ({
  supabase: {
    auth: {
      signInWithPassword: vi.fn()
    }
  }
}));

describe('SellerConsoleLoginPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the clean black & white login page with brand header', () => {
    render(<SellerConsoleLoginPage onLoginSuccess={vi.fn()} />);

    expect(screen.getByText('Super Admin Console')).toBeInTheDocument();
    expect(screen.getByText(/Enterprise Multi-Tenant Infrastructure/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText('superadmin@geosphere.my')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Sign In to Console/i })).toBeInTheDocument();
  });

  it('submits credentials and invokes onLoginSuccess on valid login', async () => {
    const mockSession = { user: { id: 'admin-1', email: 'admin@geosphere.my' } };
    (supabase.auth.signInWithPassword as any).mockResolvedValueOnce({
      data: { session: mockSession },
      error: null
    });

    const onLoginSuccess = vi.fn();
    render(<SellerConsoleLoginPage onLoginSuccess={onLoginSuccess} />);

    fireEvent.change(screen.getByPlaceholderText('superadmin@geosphere.my'), {
      target: { value: 'admin@geosphere.my' }
    });
    fireEvent.change(screen.getByPlaceholderText('••••••••••••'), {
      target: { value: 'securepassword123' }
    });

    fireEvent.click(screen.getByRole('button', { name: /Sign In to Console/i }));

    await waitFor(() => {
      expect(supabase.auth.signInWithPassword).toHaveBeenCalledWith({
        email: 'admin@geosphere.my',
        password: 'securepassword123'
      });
      expect(onLoginSuccess).toHaveBeenCalledWith(mockSession);
    });
  });

  it('displays clean error message when credentials are invalid', async () => {
    (supabase.auth.signInWithPassword as any).mockResolvedValueOnce({
      data: { session: null },
      error: { message: 'Invalid login credentials' }
    });

    render(<SellerConsoleLoginPage onLoginSuccess={vi.fn()} />);

    fireEvent.change(screen.getByPlaceholderText('superadmin@geosphere.my'), {
      target: { value: 'wrong@geosphere.my' }
    });
    fireEvent.change(screen.getByPlaceholderText('••••••••••••'), {
      target: { value: 'wrongpass' }
    });

    fireEvent.click(screen.getByRole('button', { name: /Sign In to Console/i }));

    await waitFor(() => {
      expect(screen.getByText('Invalid login credentials')).toBeInTheDocument();
    });
  });
});
