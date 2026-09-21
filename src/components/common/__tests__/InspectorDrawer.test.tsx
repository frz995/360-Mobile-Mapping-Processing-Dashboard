import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { InspectorDrawer } from '../InspectorDrawer';

describe('InspectorDrawer', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders correctly when open with title, badge, and content', () => {
    render(
      <InspectorDrawer
        isOpen={true}
        onClose={vi.fn()}
        title="Defects Inspector"
        subtitle="Subgrid N93E70"
        badge={<span data-testid="test-badge">Active</span>}
        footer={<button>Save Changes</button>}
      >
        <div data-testid="drawer-content">Audit Content</div>
      </InspectorDrawer>
    );

    expect(screen.getByText('Defects Inspector')).toBeInTheDocument();
    expect(screen.getByText('Subgrid N93E70')).toBeInTheDocument();
    expect(screen.getByTestId('test-badge')).toBeInTheDocument();
    expect(screen.getByTestId('drawer-content')).toBeInTheDocument();
    expect(screen.getByText('Save Changes')).toBeInTheDocument();
  });

  it('does not render content when isOpen is false', () => {
    render(
      <InspectorDrawer
        isOpen={false}
        onClose={vi.fn()}
        title="Hidden Drawer"
      >
        <div data-testid="drawer-content">Should not be visible</div>
      </InspectorDrawer>
    );

    expect(screen.queryByTestId('drawer-content')).not.toBeInTheDocument();
  });

  it('calls onClose when close button is clicked', () => {
    const handleClose = vi.fn();
    render(
      <InspectorDrawer
        isOpen={true}
        onClose={handleClose}
        title="Test Drawer"
      >
        <div>Content</div>
      </InspectorDrawer>
    );

    const closeBtn = screen.getByLabelText('Close');
    fireEvent.click(closeBtn);
    expect(handleClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when Escape key is pressed', () => {
    const handleClose = vi.fn();
    render(
      <InspectorDrawer
        isOpen={true}
        onClose={handleClose}
        title="Test Drawer"
      >
        <div>Content</div>
      </InspectorDrawer>
    );

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(handleClose).toHaveBeenCalledTimes(1);
  });

  it('calls onNavigateNext and onNavigatePrev on J/K and arrow keys', () => {
    const onNext = vi.fn();
    const onPrev = vi.fn();

    render(
      <InspectorDrawer
        isOpen={true}
        onClose={vi.fn()}
        title="Keyboard Navigation Test"
        onNavigateNext={onNext}
        onNavigatePrev={onPrev}
      >
        <input data-testid="test-input" />
      </InspectorDrawer>
    );

    // Pressing 'j' triggers onNext
    fireEvent.keyDown(window, { key: 'j' });
    expect(onNext).toHaveBeenCalledTimes(1);

    // Pressing 'ArrowDown' triggers onNext
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    expect(onNext).toHaveBeenCalledTimes(2);

    // Pressing 'k' triggers onPrev
    fireEvent.keyDown(window, { key: 'k' });
    expect(onPrev).toHaveBeenCalledTimes(1);

    // Pressing 'ArrowUp' triggers onPrev
    fireEvent.keyDown(window, { key: 'ArrowUp' });
    expect(onPrev).toHaveBeenCalledTimes(2);

    // When focused in input, hotkeys should be ignored
    const input = screen.getByTestId('test-input');
    fireEvent.keyDown(input, { key: 'j' });
    expect(onNext).toHaveBeenCalledTimes(2); // no extra calls
  });

  it('handles width mode toggling', () => {
    const onWidthModeChange = vi.fn();

    render(
      <InspectorDrawer
        isOpen={true}
        onClose={vi.fn()}
        title="Width Mode Test"
        widthMode="compact"
        onWidthModeChange={onWidthModeChange}
      >
        <div>Content</div>
      </InspectorDrawer>
    );

    const toggleBtn = screen.getByLabelText('Toggle width mode');
    fireEvent.click(toggleBtn);
    expect(onWidthModeChange).toHaveBeenCalledWith('expanded');

    const maxBtn = screen.getByLabelText('Maximize to fullscreen');
    fireEvent.click(maxBtn);
    expect(onWidthModeChange).toHaveBeenCalledWith('fullscreen');
  });

  it('renders modal backdrop in mode="modal" and calls onClose on backdrop click', () => {
    const handleClose = vi.fn();
    const { container } = render(
      <InspectorDrawer
        isOpen={true}
        onClose={handleClose}
        title="Modal Mode Test"
        mode="modal"
      >
        <div>Modal Content</div>
      </InspectorDrawer>
    );

    const backdrop = container.querySelector('[aria-hidden="true"]');
    expect(backdrop).toBeInTheDocument();
    if (backdrop) {
      fireEvent.click(backdrop);
      expect(handleClose).toHaveBeenCalledTimes(1);
    }
  });

  it('does not render modal backdrop in mode="docked"', () => {
    const { container } = render(
      <InspectorDrawer
        isOpen={true}
        onClose={vi.fn()}
        title="Docked Mode Test"
        mode="docked"
      >
        <div>Docked Content</div>
      </InspectorDrawer>
    );

    const backdrop = container.querySelector('[aria-hidden="true"]');
    expect(backdrop).not.toBeInTheDocument();
  });
});
