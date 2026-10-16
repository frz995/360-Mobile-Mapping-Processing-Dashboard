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
});
