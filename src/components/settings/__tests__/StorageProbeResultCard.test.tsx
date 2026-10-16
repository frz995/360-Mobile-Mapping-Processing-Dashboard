import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StorageProbeResultCard, type StorageProbeCardResult } from '../StorageProbeResultCard';

/**
 * The card is the last thing standing between an operator and a fabricated
 * green light.
 *
 * WHY THESE TESTS EXIST
 *   The panel this replaced reported "Storage Reachable &bull; HTTP 200
 *   Operational" for Supabase and NAS providers without issuing a single
 *   request — the 200 was synthesised from a database query, the latency was
 *   that query's, and `CORS OK` was the literal `true`. In production every
 *   panorama answered 400 while the panel called storage healthy.
 *
 *   So the property under test is narrow and absolute: the card must not read
 *   as good news about a file it did not fetch. `objectFound === null` means no
 *   request completed, and that renders amber "Object Not Probed" — never the
 *   emerald served styling.
 */
const base: StorageProbeCardResult = {
  ok: false,
  reachable: true,
  objectFound: null,
  status: 200,
  statusText: 'OK',
  latencyMs: 23,
  imageUrl: 'https://example.test/N93E70-0001.jpg',
  corsOk: false
};

describe('StorageProbeResultCard', () => {
  it('reports a served object in green', () => {
    render(<StorageProbeResultCard result={{ ...base, ok: true, objectFound: true }} />);

    expect(screen.getByText(/Object Served/)).toBeTruthy();
  });

  it('reports a reachable endpoint with a missing object as a KEY problem', () => {
    // The exact production failure: Supabase answers 400 Object not found. The
    // endpoint and credentials are fine, so calling this a connection failure
    // would send the operator to the wrong machine.
    render(
      <StorageProbeResultCard
        result={{ ...base, objectFound: false, status: 400, statusText: 'Object Not Found (HTTP 400)' }}
      />
    );

    expect(screen.getByText(/Storage Reachable · Object Not Found \(HTTP 400\)/)).toBeTruthy();
    expect(screen.getByText(/credentials are fine/i)).toBeTruthy();
  });

  it('never reports good news when nothing was probed', () => {
    // THE REGRESSION. An unmeasured object must not be dressed as healthy.
    render(<StorageProbeResultCard result={{ ...base, objectFound: null }} />);

    expect(screen.getByText(/Object Not Probed/)).toBeTruthy();
    expect(screen.queryByText(/Object Served/)).toBeNull();
    expect(screen.queryByText(/Storage Reachable ·/)).toBeNull();
  });

  it('shows no latency for a request that never happened', () => {
    render(<StorageProbeResultCard result={{ ...base, objectFound: null, status: 0, latencyMs: 0 }} />);

    expect(screen.queryByText(/Object fetch/)).toBeNull();
  });

  it('does not claim CORS unless a response arrived', () => {
    const { rerender } = render(<StorageProbeResultCard result={{ ...base, corsOk: false }} />);
    expect(screen.queryByText('CORS OK')).toBeNull();

    rerender(<StorageProbeResultCard result={{ ...base, corsOk: true, objectFound: true, ok: true }} />);
    expect(screen.getByText('CORS OK')).toBeTruthy();
  });

  it('keeps database latency visibly separate from the object fetch', () => {
    // The old panel showed a PostGIS timing under an image verdict. Both are
    // allowed to appear, but the card must label which is which.
    render(
      <StorageProbeResultCard
        result={{ ...base, objectFound: true, ok: true, dbLatencyMs: 23, bucketStatus: 'operational', indexedFiles: 1204 }}
      />
    );

    expect(screen.getByText(/Object fetch 23ms/)).toBeTruthy();
    expect(screen.getByText(/does not indicate whether this file exists/i)).toBeTruthy();
  });

  it('renders an unenumerated inventory as unknown rather than as zero files', () => {
    render(
      <StorageProbeResultCard
        result={{ ...base, objectFound: true, ok: true, dbLatencyMs: 12, indexedFiles: null }}
      />
    );

    expect(screen.getByText(/inventory not enumerated/)).toBeTruthy();
    expect(screen.queryByText(/0 files indexed/)).toBeNull();
  });
});