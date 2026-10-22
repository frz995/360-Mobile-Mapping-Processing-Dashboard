import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { OrganizationFormModal } from '../panels/OrganizationFormModal';
import type { Organization } from '../../../services/tenantContext';

const createOrganizationMock = vi.fn().mockResolvedValue({ success: true });
const updateOrganizationMock = vi.fn().mockResolvedValue({ success: true });

vi.mock('../../../services/tenantContext', () => ({
  createOrganization: (...args: unknown[]) => createOrganizationMock(...args),
  updateOrganization: (...args: unknown[]) => updateOrganizationMock(...args),
  testDedicatedDatabaseConnection: vi.fn().mockResolvedValue({ success: true, message: 'Connected' })
}));

const sampleOrg: Organization = {
  id: '00000000-0000-4000-8000-000000000001',
  name: 'GeoSphere - DevTest',
  slug: 'geosphere-devtest',
  clientCode: 'DevTest',
  databaseType: 'dedicated_external',
  databaseConfig: { url: 'https://example.supabase.co', anonKey: 'anon-key-123' },
  status: 'active',
  licenseType: 'enterprise_dedicated',
  licenseExpiresAt: null,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  settings: {
    allowedUserSeats: 2,
    storageQuotaGb: 1,
    contactEmail: 'fariz.farhan95@gmail.com',
    storage: {
      provider: 'cloudflare_r2',
      bucketName: 'geosphere-panorama',
      cdnUrl: 'https://pub-23569d9628d547acb97ec86212ecd51a.r2.dev',
      imageStorageStrategy: 'multires_tiles'
    }
  }
};

const unlimitedOrg: Organization = {
  ...sampleOrg,
  settings: {
    contactEmail: 'fariz.farhan95@gmail.com',
    storage: {
      provider: 'cloudflare_r2',
      bucketName: 'geosphere-panorama',
      cdnUrl: 'https://pub-23569d9628d547acb97ec86212ecd51a.r2.dev',
      imageStorageStrategy: 'multires_tiles'
    }
  }
};

/**
 * The licensed-seats input.
 *
 * `Field` renders a `<label>` with no `htmlFor`, so the label is not
 * associated with the input and `getByLabelText` cannot find it. The field
 * wrapper is the nearest ancestor div, which holds exactly one input.
 */
function seatsFieldInput(): HTMLInputElement {
  const field = screen.getByText('Licensed Seats').closest('div');
  const input = field?.querySelector('input') as HTMLInputElement | null;
  if (!input) throw new Error('The licensed-seats input was not rendered.');
  return input;
}

/** The settings exactly as they would reach the database. */
function writtenSettings(): Record<string, unknown> {
  const payload = updateOrganizationMock.mock.calls[0][1] as { settings: Record<string, unknown> };
  return JSON.parse(JSON.stringify(payload.settings)) as Record<string, unknown>;
}

describe('OrganizationFormModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the 360° Storage & Slicing Strategy dropdown with multi-resolution tiles and single equirectangular options', () => {
    render(
      <OrganizationFormModal
        editing={sampleOrg}
        onClose={vi.fn()}
        onSaved={vi.fn()}
        onFailed={vi.fn()}
      />
    );

    expect(screen.getByText('360° Storage & Slicing Strategy')).toBeDefined();
    const strategySelect = screen.getByDisplayValue(/Multi-Resolution Tile Pyramid/i) as HTMLSelectElement;
    expect(strategySelect).toBeDefined();
    expect(strategySelect.value).toBe('multires_tiles');

    // Change to single equirectangular
    fireEvent.change(strategySelect, { target: { value: 'single_equirectangular' } });
    expect(strategySelect.value).toBe('single_equirectangular');
  });

  it('saves updated imageStorageStrategy when submitted', async () => {
    const onSaved = vi.fn();
    render(
      <OrganizationFormModal
        editing={sampleOrg}
        onClose={vi.fn()}
        onSaved={onSaved}
        onFailed={vi.fn()}
      />
    );

    const strategySelect = screen.getByDisplayValue(/Multi-Resolution Tile Pyramid/i);
    fireEvent.change(strategySelect, { target: { value: 'single_equirectangular' } });

    const submitBtn = screen.getByRole('button', { name: /Save Changes/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(updateOrganizationMock).toHaveBeenCalledWith(
        sampleOrg.id,
        expect.objectContaining({
          settings: expect.objectContaining({
            storage: expect.objectContaining({
              imageStorageStrategy: 'single_equirectangular'
            })
          })
        })
      );
      expect(onSaved).toHaveBeenCalledWith('Company updated.');
    });
  });

  it('renders into document.body via portal and mounts with top visibility', () => {
    render(
      <OrganizationFormModal
        editing={null}
        onClose={vi.fn()}
        onSaved={vi.fn()}
        onFailed={vi.fn()}
      />
    );

    const dialog = screen.getByRole('dialog', { name: /Register New Client Company/i });
    expect(dialog).toBeDefined();
    expect(document.body.contains(dialog)).toBe(true);

    // Form inputs at the top are present and rendered
    expect(screen.getByPlaceholderText('e.g. Tenaga Nasional Berhad')).toBeDefined();
    expect(screen.getByPlaceholderText('e.g. TNB-LV-2026')).toBeDefined();
  });

  it('does not write a limit onto a company that has none on file', async () => {
    render(
      <OrganizationFormModal
        editing={unlimitedOrg}
        onClose={vi.fn()}
        onSaved={vi.fn()}
        onFailed={vi.fn()}
      />
    );

    // The form shows "no limit", not a default of ten.
    expect(seatsFieldInput().value).toBe('');

    fireEvent.click(screen.getByRole('button', { name: /Save Changes/i }));

    await waitFor(() => expect(updateOrganizationMock).toHaveBeenCalled());

    // The old edit path substituted `?? 10` and `?? 200`, so saving an
    // unrelated field on an unlimited company silently capped it at ten
    // seats and 200 GB. Nobody chose those numbers.
    const written = writtenSettings();
    expect(written.allowedUserSeats).toBeUndefined();
    expect(written.storageQuotaGb).toBeUndefined();
  });

  it('writes the absence of a limit when the box is cleared, not a limit of zero', async () => {
    render(
      <OrganizationFormModal
        editing={sampleOrg}
        onClose={vi.fn()}
        onSaved={vi.fn()}
        onFailed={vi.fn()}
      />
    );

    const seatsInput = seatsFieldInput();
    expect(seatsInput.value).toBe('2');

    fireEvent.change(seatsInput, { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: /Save Changes/i }));

    await waitFor(() => expect(updateOrganizationMock).toHaveBeenCalled());

    // The old input wrote `Number(value) || 0`, so clearing the box saved a
    // company with no seats — a limit of zero — rather than a company with
    // no limit. A configured zero is still a zero, but this is not one.
    const written = writtenSettings();
    expect(written.allowedUserSeats).toBeUndefined();
    expect(written.allowedUserSeats).not.toBe(0);

    // The limit the seller did not touch is untouched.
    expect(written.storageQuotaGb).toBe(1);
  });
});
