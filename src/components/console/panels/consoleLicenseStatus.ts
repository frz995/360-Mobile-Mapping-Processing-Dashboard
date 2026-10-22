/**
 * Licence expiry status.
 *
 * WHY IT IS ITS OWN MODULE
 *   Three panels render it — the dashboard, the company directory and the
 *   database hub — and it was exported from the dashboard panel, so two panels
 *   imported a component module to get a pure date function. That coupling is
 *   what made the dashboard's per-company table awkward to extract: the table
 *   would have had to import the panel it was being extracted FROM.
 *
 * THE FOUR STATES
 *   no expiry date  -> perpetual. A real, known fact: the licence never ends.
 *   unparseable     -> invalid, and rendered as such rather than as a date.
 *   already past    -> expired.
 *   within 30 days  -> expiring soon.
 *   otherwise       -> active, with the days remaining.
 */

export interface LicenseExpiryStatus {
  label: string;
  tone: 'active' | 'warning' | 'expired' | 'neutral';
}

export function getLicenseExpiryStatus(expiresAt: string | null): LicenseExpiryStatus {
  if (!expiresAt) {
    return { label: 'Perpetual', tone: 'neutral' };
  }
  const expiry = new Date(expiresAt).getTime();
  if (isNaN(expiry)) {
    return { label: 'Invalid Date', tone: 'neutral' };
  }

  const now = Date.now();
  const diffDays = Math.ceil((expiry - now) / (1000 * 60 * 60 * 24));

  if (diffDays < 0) {
    return { label: `Expired (${Math.abs(diffDays)}d ago)`, tone: 'expired' };
  }
  if (diffDays <= 30) {
    return { label: `Expiring soon (${diffDays}d left)`, tone: 'warning' };
  }
  return { label: `Active (${diffDays}d left)`, tone: 'active' };
}

export default getLicenseExpiryStatus;
