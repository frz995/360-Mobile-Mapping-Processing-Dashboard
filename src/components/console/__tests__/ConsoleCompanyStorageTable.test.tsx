import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ConsoleCompanyStorageTable } from '../panels/ConsoleCompanyStorageTable';

vi.mock('../panels/consoleLicenseStatus', () => ({
  getLicenseExpiryStatus: () => ({ label: 'Perpetual', tone: 'neutral' })
}));

const ORG = {
  id: 'org-1',
  name: 'Tenaga Nasional Berhad',
  slug: 'tnb',
  clientCode: 'TNB-LV-2026',
  databaseType: 'cloud_shared',
  databaseConfig: {},
  status: 'active',
  licenseType: 'cloud_saas',
  licenseExpiresAt: null,
  settings: { allowedUserSeats: 15, storageQuotaGb: 500 },
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01'
} as any;

describe('ConsoleCompanyStorageTable', () => {
  it('renders a clean row with no badge boxes', () => {
    const { container } = render(
      <ConsoleCompanyStorageTable
        organizations={[ORG]}
        breakdown={[]}
        storageError={null}
        isStorageLoading={false}
      />
    );

    expect(screen.getByText('Tenaga Nasional Berhad')).toBeInTheDocument();
    expect(screen.getByText('TNB-LV-2026')).toBeInTheDocument();
    expect(screen.getByText('Cloud shared')).toBeInTheDocument();
    expect(screen.getByText('Cloud SaaS')).toBeInTheDocument();
    expect(screen.getByText('15')).toBeInTheDocument();
    expect(screen.getByText('active')).toBeInTheDocument();
    expect(screen.getByText('Not in the inventory')).toBeInTheDocument();

    // The table stopped wearing boxes: no bordered pill, no tinted chip
    // fill. The one rounded-full left is the status dot, which carries no
    // border, and the small-caps header is typography rather than a badge.
    const html = container.innerHTML;
    expect(html).not.toMatch(/rounded-full[^"']*border/);
    expect(html).not.toMatch(/border[^"']*rounded-full/);
    expect(html).not.toMatch(/bg-(emerald|amber|rose|blue|sky)-100/);
    expect(html).not.toMatch(/px-2[^"']*py-0\.5/);
    expect(html).not.toMatch(/px-2\.5[^"']*py-0\.5/);
  });

  it('shows em dashes for an unmeasured row, never zeros', () => {
    render(
      <ConsoleCompanyStorageTable
        organizations={[ORG]}
        breakdown={[]}
        storageError="broken"
        isStorageLoading={false}
      />
    );
    const row = screen.getAllByText('Tenaga Nasional Berhad')[0].closest('tr');
    const text = row?.textContent || '';
    expect(text).toContain('—');
    expect(text).not.toMatch(/0\s*files/);
    expect(text).not.toMatch(/0\s*B/);
  });

  it('says Unlimited for an unconfigured seat limit', () => {
    const unlimited = { ...ORG, settings: { contactEmail: 'a@b.c' } } as any;
    render(
      <ConsoleCompanyStorageTable
        organizations={[unlimited]}
        breakdown={[]}
        storageError={null}
        isStorageLoading={false}
      />
    );
    const row = screen.getAllByText('Tenaga Nasional Berhad')[0].closest('tr');
    expect(row?.textContent || '').toContain('Unlimited');
    expect(row?.textContent || '').not.toMatch(/0\s*seats/);
  });

  it('shows BYOS as a plain line, with no card and no emoji', () => {
    const byosOrg = {
      ...ORG,
      id: 'org-2',
      databaseType: 'dedicated_external',
      settings: {
        allowedUserSeats: 40,
        storageQuotaGb: 2000,
        storage: {
          provider: 'cloudflare_r2',
          bucketName: 'geosphere-panorama',
          byosQuotaGb: 100,
          byosConsumedBytes: 82 * 1024 * 1024 * 1024
        }
      }
    } as any;

    render(
      <ConsoleCompanyStorageTable
        organizations={[byosOrg]}
        breakdown={[]}
        storageError={null}
        isStorageLoading={false}
      />
    );
    expect(screen.getByText(/Cloudflare R2 bucket/)).toBeInTheDocument();
    expect(screen.getByText('geosphere-panorama')).toBeInTheDocument();
    expect(screen.queryByText(/Zero Egress/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/🚨/)).not.toBeInTheDocument();
    expect(screen.queryByText(/⚠️/)).not.toBeInTheDocument();
  });
});
