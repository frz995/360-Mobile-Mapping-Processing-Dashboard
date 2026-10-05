import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, act, cleanup, fireEvent } from '@testing-library/react';
import { WriteFailureBanner } from '../WriteFailureBanner';
import {
  reportWriteFailure,
  reportWriteSuccess,
  clearWriteFailures,
  getWriteFailures
} from '../../../lib/writeFailures';

// A rejected Supabase write must be visible without opening devtools. This was
// the failure mode that hid the QA/QC `onConflict` mismatch for months: the
// console showed a warning, the UI looked correct, and the count only reverted
// on refresh.
describe('WriteFailureBanner', () => {
  beforeEach(() => clearWriteFailures());
  afterEach(() => {
    cleanup();
    clearWriteFailures();
  });

  it('renders nothing when no write has failed', () => {
    render(<WriteFailureBanner />);
    expect(screen.queryByTestId('write-failure-banner')).toBeNull();
  });

  it('shows a single failed write with its label and error detail', () => {
    render(<WriteFailureBanner />);
    act(() => {
      reportWriteFailure('qaqc.audit_run', 'QA/QC audit summary — N93E70', 'duplicate key value');
    });

    expect(screen.getByTestId('write-failure-banner')).toBeInTheDocument();
    expect(screen.getByText(/1 change could not be saved/i)).toBeInTheDocument();
    expect(screen.getByText('QA/QC audit summary — N93E70')).toBeInTheDocument();
    expect(screen.getByText('duplicate key value')).toBeInTheDocument();
  });

  it('warns the operator that on-screen data may not be stored', () => {
    render(<WriteFailureBanner />);
    act(() => {
      reportWriteFailure('qaqc.audit_run', 'QA/QC audit summary');
    });
    expect(screen.getByText(/may not be stored/i)).toBeInTheDocument();
  });

  it('reports the attempt count when an operation failed repeatedly', () => {
    render(<WriteFailureBanner />);
    act(() => {
      reportWriteFailure('qaqc.defect_batch', 'QA/QC defect results', 'timeout');
      reportWriteFailure('qaqc.defect_batch', 'QA/QC defect results', 'timeout');
    });

    // A retry loop collapses to one line rather than flooding the banner.
    expect(screen.getByText(/2 failed attempts/)).toBeInTheDocument();
  });

  it('lists each failing operation separately', () => {
    render(<WriteFailureBanner />);
    act(() => {
      reportWriteFailure('a', 'Audit summary');
      reportWriteFailure('b', 'Masterlist record');
    });

    expect(screen.getByText(/2 changes could not be saved/i)).toBeInTheDocument();
    expect(screen.getByText('Audit summary')).toBeInTheDocument();
    expect(screen.getByText('Masterlist record')).toBeInTheDocument();
  });

  it('dismisses one operation without hiding the others', () => {
    render(<WriteFailureBanner />);
    act(() => {
      reportWriteFailure('a', 'Audit summary');
      reportWriteFailure('b', 'Masterlist record');
    });

    fireEvent.click(screen.getByRole('button', { name: /dismiss audit summary save failure/i }));

    expect(screen.queryByText('Audit summary')).toBeNull();
    expect(screen.getByText('Masterlist record')).toBeInTheDocument();
  });

  it('dismisses everything from the bulk control', () => {
    render(<WriteFailureBanner />);
    act(() => {
      reportWriteFailure('a', 'Audit summary');
      reportWriteFailure('b', 'Masterlist record');
    });

    fireEvent.click(screen.getByRole('button', { name: /dismiss all/i }));

    expect(screen.queryByTestId('write-failure-banner')).toBeNull();
    expect(getWriteFailures()).toHaveLength(0);
  });

  it('disappears once the underlying write succeeds', () => {
    render(<WriteFailureBanner />);
    act(() => {
      reportWriteFailure('qaqc.audit_run', 'QA/QC audit summary');
    });
    expect(screen.getByTestId('write-failure-banner')).toBeInTheDocument();

    act(() => {
      reportWriteSuccess('qaqc.audit_run');
    });

    expect(screen.queryByTestId('write-failure-banner')).toBeNull();
  });

  it('keeps updating a surviving instance after another unmounts', () => {
    // Two banners on screen: unmounting one must not tear down the store
    // subscription the other one still depends on.
    const first = render(<WriteFailureBanner />);
    const second = render(<WriteFailureBanner />);

    act(() => {
      reportWriteFailure('a', 'Audit summary');
    });
    expect(screen.getAllByText('Audit summary')).toHaveLength(2);

    first.unmount();
    act(() => {
      reportWriteFailure('b', 'Masterlist record');
    });

    const banners = screen.getAllByTestId('write-failure-banner');
    expect(banners).toHaveLength(1);
    expect(screen.getByText('Masterlist record')).toBeInTheDocument();
    second.unmount();
  });

  it('announces itself assertively for screen readers', () => {
    render(<WriteFailureBanner />);
    act(() => {
      reportWriteFailure('a', 'Audit summary');
    });

    const banner = screen.getByTestId('write-failure-banner');
    expect(banner).toHaveAttribute('role', 'alert');
    expect(banner).toHaveAttribute('aria-live', 'assertive');
  });
});
