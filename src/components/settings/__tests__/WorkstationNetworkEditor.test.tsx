import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { WorkstationNetworkEditor } from '../WorkstationNetworkEditor';
import { normalizeWorkstations } from '../../../utils/workstationNetwork';

function setup(value: Parameters<typeof WorkstationNetworkEditor>[0]['value'] = null) {
  const onChange = vi.fn();
  render(<WorkstationNetworkEditor value={value} onChange={onChange} />);
  return onChange;
}

/** Each station card repeats the same field labels, so scope to one card. */
function card(id: string) {
  return within(screen.getByTestId(`workstation-${id}`));
}

describe('WorkstationNetworkEditor', () => {
  it('renders one addressable card per shipped station', () => {
    setup();
    expect(screen.getByTestId('workstation-blur')).toBeTruthy();
    expect(screen.getByTestId('workstation-stitch')).toBeTruthy();
    expect(screen.getByTestId('workstation-lightroom')).toBeTruthy();
    expect(screen.getByTestId('workstation-photoshop')).toBeTruthy();
  });

  it('never ships an invented address', () => {
    setup();
    const ip = card('blur').getByLabelText(/IP address or hostname/i) as HTMLInputElement;
    expect(ip.value).toBe('');
  });

  it('reports the unconfigured state before any address is set', () => {
    setup();
    for (const id of ['blur', 'stitch', 'lightroom', 'photoshop']) {
      expect(card(id).getByText(/unconfigured/i)).toBeTruthy();
    }
    expect(screen.getByText(/0 of 4 stations configured/i)).toBeTruthy();
  });

  it('renders the configured count as plain text, not a coloured badge', () => {
    setup();
    const count = screen.getByText(/0 of 4 stations configured/i);
    // A badge/textbox would carry a tinted background, a border and/or rounding.
    const className = count.className || '';
    expect(className).not.toMatch(/rounded|bg-|border|amber|emerald|px-|py-/);
  });

  it('scales field labels and inputs down to the panel scale', () => {
    setup();
    // Without an explicit size these inherit the 16px body default and render
    // larger than the section heading.
    const label = card('blur').getByLabelText(/IP address or hostname/i);
    expect(label.className).toContain('text-[11px]');

    const ip = card('blur').getByLabelText(/IP address or hostname/i) as HTMLInputElement;
    expect(ip.className).toContain('text-[11px]');
    expect(ip.className).not.toMatch(/(^|\s)px-3(\s|$)/);
  });

  it('shows a station as ready once its address is stored', () => {
    setup(normalizeWorkstations([{ id: 'blur', ipAddress: '10.20.30.11' } as never]));
    expect(screen.getByText(/1 of 4 stations configured/i)).toBeTruthy();
    expect(card('blur').getByText(/ready/i)).toBeTruthy();
  });

  it('emits an immutable patch when an address is typed', () => {
    const onChange = setup();
    fireEvent.change(card('blur').getByLabelText(/IP address or hostname/i), {
      target: { value: '10.20.30.12' }
    });

    expect(onChange).toHaveBeenCalled();
    const emitted = onChange.mock.calls[0][0];
    expect(emitted.find((s: { id: string }) => s.id === 'blur').ipAddress).toBe('10.20.30.12');
    // only the edited station carries an address
    expect(emitted.filter((s: { ipAddress?: string }) => Boolean(s.ipAddress))).toHaveLength(1);
  });

  it('flags a mistyped address without blocking the panel', () => {
    setup(normalizeWorkstations([{ id: 'blur', ipAddress: '10.20.30' } as never]));
    expect(card('blur').getByText(/check address/i)).toBeTruthy();
    expect(card('stitch').queryByText(/check address/i)).toBeNull();
  });

  it('surfaces the agent and RDP defaults so the operator knows what to type', () => {
    setup();
    expect(screen.getByText(/default agent port 8000/i)).toBeTruthy();
    expect(screen.getByText(/rdp 3389/i)).toBeTruthy();
  });

  it('offers both live-desktop channels', () => {
    setup();
    const select = card('blur').getByLabelText(/live desktop channel/i) as HTMLSelectElement;
    expect([...select.options].map(o => o.value)).toEqual(['rdp', 'vnc']);
  });

  it('explains why an HTTPS deployment needs the public noVNC URL', () => {
    setup();
    expect(screen.getByText(/blocks a private/i)).toBeTruthy();
  });
});
