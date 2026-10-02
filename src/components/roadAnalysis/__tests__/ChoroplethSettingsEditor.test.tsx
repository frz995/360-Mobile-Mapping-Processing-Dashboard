import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { ChoroplethSettingsEditor } from '../ChoroplethSettingsEditor';
import { createDefaultSetting, classColors, type ChoroplethSetting } from '../../../utils/choroplethSettings';

const METRIC = 'density';

function makeSettings(overrides?: Partial<ChoroplethSetting>) {
  return { [METRIC]: { ...createDefaultSetting(METRIC, 'greens'), ...overrides } };
}

/**
 * Fresh spies per render: module-level `vi.fn()`s would accumulate calls across
 * tests and make `mock.calls[0]` point at an earlier test's value.
 */
function openEditor(overrides: Record<string, unknown> = {}) {
  const props = {
    metric: METRIC,
    palette: 'greens' as const,
    settings: makeSettings(),
    metricValues: [0.5, 1.2, 2.0, 3.0, 4.5, 6.5, 9.5, 20],
    onApply: vi.fn(),
    onSave: vi.fn(),
    onPaletteChange: vi.fn(),
    onClose: vi.fn(),
    ...overrides
  };
  const utils = render(<ChoroplethSettingsEditor {...(props as any)} />);
  return { props, ...utils };
}

const classSwatches = () =>
  screen.getAllByLabelText(/Class \d colour/) as HTMLInputElement[];

describe('ChoroplethSettingsEditor', () => {
  it('opens with Apply/Save disabled until something changes', () => {
    openEditor();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Save/ })).toBeDisabled();
  });

  it('applies a manually typed class bound', () => {
    const { props } = openEditor();

    fireEvent.change(screen.getByLabelText('Class 2 upper bound'), { target: { value: '4.25' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

    expect(props.onApply).toHaveBeenCalledTimes(1);
    const applied = props.onApply.mock.calls[0][0] as ChoroplethSetting;
    expect(applied.method).toBe('manual');
    expect(applied.classes[1].upperBound).toBe(4.25);
    expect(props.onSave).not.toHaveBeenCalled();
  });

  it('switches method to manual when a bound is typed', () => {
    openEditor();
    expect(screen.getByRole('button', { name: /Quantile/ })).toHaveAttribute('aria-pressed', 'false');
    fireEvent.change(screen.getByLabelText('Class 1 upper bound'), { target: { value: '2' } });
    expect(screen.getByRole('button', { name: /^Manual$/ })).toHaveAttribute('aria-pressed', 'true');
  });

  it('applies a palette change through both the ramp picker and the map palette', () => {
    const { props } = openEditor();
    fireEvent.click(screen.getByRole('button', { name: 'Use purples ramp' }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

    expect(props.onPaletteChange).toHaveBeenCalledWith('purples');
    const applied = props.onApply.mock.calls[0][0] as ChoroplethSetting;
    const purples = createDefaultSetting(METRIC, 'purples');
    expect(applied.classes.map(c => c.color)).toEqual(purples.classes.map(c => c.color));
  });

  it('persists a setting on Save', () => {
    const { props } = openEditor();
    fireEvent.change(screen.getByLabelText('Class 3 upper bound'), { target: { value: '7' } });
    fireEvent.click(screen.getByRole('button', { name: /Save/ }));

    expect(props.onSave).toHaveBeenCalledTimes(1);
    expect((props.onSave.mock.calls[0][0] as ChoroplethSetting).classes[2].upperBound).toBe(7);
  });

  it('Cancel discards the draft without applying', () => {
    const { props } = openEditor();
    fireEvent.change(screen.getByLabelText('Class 1 upper bound'), { target: { value: '99' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(props.onApply).not.toHaveBeenCalled();
    expect(props.onSave).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
  });

  it('Cancel restores the last applied value, not the first one', () => {
    const { props } = openEditor();

    fireEvent.change(screen.getByLabelText('Class 2 upper bound'), { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    fireEvent.change(screen.getByLabelText('Class 3 upper bound'), { target: { value: '77' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.getByDisplayValue('5')).toBeInTheDocument();
    expect(screen.queryByDisplayValue('77')).not.toBeInTheDocument();
    expect(props.onApply).toHaveBeenCalledTimes(1);
  });

  it('adds and removes classes within the supported range', () => {
    openEditor();
    const remove = screen.getByRole('button', { name: 'Remove class' });
    const add = screen.getByRole('button', { name: 'Add class' });

    fireEvent.click(remove);
    expect(screen.getByText('density · 4 classes')).toBeInTheDocument();
    fireEvent.click(remove);
    fireEvent.click(remove);
    expect(screen.getByText('density · 2 classes')).toBeInTheDocument();
    expect(remove).toBeDisabled();

    fireEvent.click(add);
    fireEvent.click(add);
    fireEvent.click(add);
    expect(screen.getByText('density · 5 classes')).toBeInTheDocument();
    expect(add).toBeDisabled();
  });

  it('leaves the top class without an upper bound input', () => {
    openEditor();
    expect(screen.queryByLabelText('Class 5 upper bound')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Class 4 upper bound')).toBeInTheDocument();
  });

  it('previews class colours in the order the map paints them', () => {
    const setting = createDefaultSetting(METRIC, 'greens');
    openEditor();
    // Rows are low-value-first, matching the class order.
    expect(classSwatches().map(s => s.value)).toEqual(setting.classes.map(c => c.color));
  });

  it('reflects a reversed ramp in the swatches without reordering rows', () => {
    const reversed = { ...createDefaultSetting(METRIC, 'greens'), reverse: true };
    openEditor({ settings: { density: reversed } });
    // Swatches show what the map paints on class i — the reversed ramp.
    expect(classSwatches().map(s => s.value)).toEqual(classColors(reversed));
  });

  it('toggles the ramp direction on Apply', () => {
    const { props } = openEditor();
    fireEvent.click(screen.getByRole('button', { name: /Reverse ramp/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

    const applied = props.onApply.mock.calls[0][0] as ChoroplethSetting;
    expect(applied.reverse).toBe(true);
    // Bounds stay ascending when the ramp flips.
    const bounds = applied.classes.slice(0, -1).map(c => c.upperBound as number);
    expect([...bounds].sort((a, b) => a - b)).toEqual(bounds);
  });

  it('applies opacity changes', () => {
    const { props } = openEditor();
    fireEvent.change(screen.getByLabelText('Fill opacity'), { target: { value: '0.4' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect((props.onApply.mock.calls[0][0] as ChoroplethSetting).alpha).toBe(0.4);
  });

  it('computes natural breaks from the observed values', () => {
    const { props } = openEditor();
    fireEvent.click(screen.getByRole('button', { name: /Natural/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

    const applied = props.onApply.mock.calls[0][0] as ChoroplethSetting;
    expect(applied.method).toBe('natural');
    const bounds = applied.classes.slice(0, -1).map(c => c.upperBound as number);
    expect(Math.max(...bounds)).toBeLessThanOrEqual(20);
  });

  it('closes on the close button', () => {
    const { props } = openEditor();
    fireEvent.click(screen.getByRole('button', { name: 'Close settings' }));
    expect(props.onClose).toHaveBeenCalled();
  });

  it('seeds from the saved setting for the requested metric', () => {
    const custom: ChoroplethSetting = {
      metric: METRIC,
      method: 'manual',
      alpha: 0.7,
      reverse: false,
      classes: [
        { upperBound: 11, color: '#010101' },
        { upperBound: 22, color: '#020202' },
        { upperBound: null, color: '#030303' }
      ]
    };
    openEditor({ settings: { density: custom } });
    expect(screen.getByText('density · 3 classes')).toBeInTheDocument();
    expect(screen.getByDisplayValue('11')).toBeInTheDocument();
    expect(screen.getByDisplayValue('22')).toBeInTheDocument();
  });

  it('falls back to the palette defaults when the metric has no saved setting', () => {
    openEditor({ settings: {} });
    expect(screen.getByText('density · 5 classes')).toBeInTheDocument();
    expect(screen.getByDisplayValue('1.5')).toBeInTheDocument();
  });

  it('keeps the dialog labelled for assistive tech', () => {
    openEditor();
    const dialog = screen.getByRole('dialog', { name: 'Choropleth symbol settings' });
    expect(within(dialog).getAllByRole('button').length).toBeGreaterThan(0);
  });
});
