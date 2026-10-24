/**
 * The per-company directory + storage table.
 *
 * WHY IT IS ITS OWN MODULE
 *   It is the largest block in the dashboard panel, and it is the block that
 *   had the most confident wrong numbers in it: a failed storage read made
 *   every registered company read as "0 B / 0 files", because the cells were
 *   computed as `b ? … : 0` and `b?.mmsPicBytes (fallback-to-zero)`.
 *
 * THE THREE-WAY CELL
 *   A usage cell can be in one of three states, and they must look different:
 *
 *     measured      the inventory read succeeded and returned a row for this
 *                   company. `0 B` here is a real measurement — "looked, found
 *                   nothing" — and it is allowed to print a zero.
 *     not returned  the read succeeded but this company had no row. Unknown.
 *     read failed   no breakdown at all. Unknown, for every company.
 *
 *   The second and third cases both render an em dash, because the operator's
 *   question is the same one in both: "how much has this company stored?" —
 *   and the answer is "not known". Neither is a zero.
 *
 * WHY IT IS PLAIN
 *   The first version of this table was a wall of boxes: a licence-type pill
 *   beside an expiry pill, a green card for every BYOS company with a "Zero
 *   Egress" badge inside it, and a chip per bucket. Eight or nine bordered
 *   shapes in a single row, and the shapes were louder than the numbers they
 *   wrapped — the operator was reading labels, not figures.
 *
 *   The rule now is that the numbers are the content and everything else is
 *   typography. A status is a dot and a word. An expiry is a word, coloured
 *   only when it is the thing you would act on. A bucket is a label and a
 *   value on one line. Exactly one filled shape is left in the table — the
 *   quota bar — because it answers a question the digits cannot: is this
 *   company close to its limit.
 *
 *   None of that is decoration. The em dash still means "not measured", and
 *   it is still the only thing that may appear where a figure was not read.
 */

import React from 'react';
import type { Organization } from '../../../services/tenantContext';
import { formatBytes, formatPercent, type CompanyStorageBreakdown } from '../../../services/consoleStorage';
import { getLicenseExpiryStatus } from './consoleLicenseStatus';
import { STATUS_DOT } from '../consoleDirectoryMetrics';

interface Props {
  organizations: Organization[];
  breakdown: CompanyStorageBreakdown[];
  /** null when the last storage read was verified. A reason when it was not. */
  storageError: string | null;
  isStorageLoading: boolean;
}

/** A measured figure, or null when it was never measured. */
function measuredBytes(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Renders a file count, or an em dash when the count was never measured. */
function measuredCount(value: number | null): string {
  return value === null ? '—' : value.toLocaleString();
}

/**
 * The quota bar.
 *
 * The one filled shape in the table. The digits say how much; the bar says
 * how close, which is the question an operator actually has about a quota.
 */
const UsageBar: React.FC<{ percent: number }> = ({ percent }) => (
  <div className="h-1 w-full max-w-[118px] rounded-full bg-slate-100 overflow-hidden">
    <div
      className={`h-1 rounded-full ${
        percent > 90 ? 'bg-rose-500' : percent > 75 ? 'bg-amber-500' : 'bg-slate-800'
      }`}
      style={{ width: `${Math.min(100, Math.max(2, percent))}%` }}
    />
  </div>
);

interface BucketLine {
  label: string;
  bytes: number | null;
  files: number | null;
}

/**
 * The licence label.
 *
 * Not CSS `capitalize`: the stored value is `cloud_saas`, and capitalising that
 * renders "Cloud Saas". These are the names the seller actually sold.
 */
const LICENSE_LABEL: Record<string, string> = {
  cloud_saas: 'Cloud SaaS',
  enterprise_dedicated: 'Enterprise',
  trial: 'Trial',
  perpetual: 'Perpetual'
};

function licenseLabel(licenseType: string | null | undefined): string {
  if (!licenseType) return 'Cloud SaaS';
  return LICENSE_LABEL[licenseType] ?? licenseType.replace(/_/g, ' ');
}

/**
 * The bucket breakdown, as label/value pairs.
 *
 * "Other" only appears when there is something in it, because a row of zeros
 * for a bucket nobody uses is noise.
 */
function bucketLines(row: CompanyStorageBreakdown | undefined): BucketLine[] {
  if (!row) return [];
  return [
    { label: 'MMS', bytes: measuredBytes(row.mmsPicBytes), files: row.mmsPicFiles },
    { label: 'Panoramas', bytes: measuredBytes(row.panoramasBytes), files: row.panoramasFiles },
    { label: 'Geometry', bytes: measuredBytes(row.geometryBytes), files: row.geometryFiles },
    ...(row.otherBytes > 0 ? [{ label: 'Other', bytes: row.otherBytes, files: row.otherFiles }] : [])
  ];
}

export const ConsoleCompanyStorageTable: React.FC<Props> = ({
  organizations,
  breakdown,
  storageError,
  isStorageLoading
}) => (
  <>
    {storageError ? (
      <div className="mt-5 px-4 py-3 rounded-xl bg-amber-50 border border-amber-200/80 text-[11px] text-amber-900 leading-relaxed">
        <strong className="font-bold">Storage usage could not be verified.</strong> Every usage figure below is
        unknown, not zero. The company rows are real — the directory read succeeded — but the inventory behind their
        storage columns was not readable.
      </div>
    ) : null}

    <div className="overflow-x-auto rounded-2xl border border-slate-100 mt-5">
      <table className="w-full text-left text-xs text-slate-700">
        <thead className="bg-slate-50/70 border-b border-slate-200">
          <tr className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            <th className="px-4 py-2.5">Company</th>
            <th className="px-4 py-2.5">Database</th>
            <th className="px-4 py-2.5">Plan</th>
            <th className="px-4 py-2.5 text-right">Seats</th>
            <th className="px-4 py-2.5 text-right">Storage Used</th>
            <th className="px-4 py-2.5 text-right">Buckets</th>
            <th className="px-4 py-2.5">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {organizations.map((org) => {
            const expiry = getLicenseExpiryStatus(org.licenseExpiresAt);
            const provider = org.settings?.storage?.provider;
            const isExternalStorage = Boolean(provider && provider !== 'supabase');
            const bucketName = org.settings?.storage?.bucketName || null;
            const row = breakdown.find((item) => item.organizationId === org.id);

            // Null means "not measured", never "zero". A company with no row in
            // a successful read is unknown too — the inventory did not account
            // for it, which is not the same as saying it stored nothing.
            const consumedBytes = row ? row.consumedStorageBytes : null;
            const consumedFiles = row ? row.consumedFilesCount : null;
            const allocatedGb = org.settings?.storageQuotaGb ?? null;
            const percentUsed =
              consumedBytes !== null && allocatedGb && allocatedGb > 0
                ? (consumedBytes / (allocatedGb * 1024 * 1024 * 1024)) * 100
                : null;
            const byosQuotaGb = org.settings?.storage?.byosQuotaGb ?? null;
            const byosConsumedBytes = org.settings?.storage?.byosConsumedBytes ?? null;
            const byosPercent =
              byosQuotaGb && byosQuotaGb > 0 && byosConsumedBytes != null
                ? (byosConsumedBytes / (byosQuotaGb * 1024 * 1024 * 1024)) * 100
                : null;

            // A BYOS tenant's files live in the external bucket and never
            // enter the platform inventory, so the platform reading is 0 by
            // construction. The bucket is therefore the figure that means
            // something, and it goes first.
            const headPercent = isExternalStorage ? byosPercent : percentUsed;

            const expiryTone =
              expiry.tone === 'expired'
                ? 'text-rose-600 font-semibold'
                : expiry.tone === 'warning'
                  ? 'text-amber-700 font-semibold'
                  : 'text-slate-500';

            return (
              <tr key={org.id} className="hover:bg-slate-50/60 transition-colors">
                <td className="px-4 py-3.5 align-top">
                  <div className="text-[13px] font-semibold text-slate-900">{org.name}</div>
                  <div className="text-[11px] font-mono text-slate-400 mt-0.5">{org.clientCode || '—'}</div>
                </td>

                <td className="px-4 py-3.5 align-top">
                  <div className="text-[12.5px] font-semibold text-slate-800">
                    {org.databaseType === 'dedicated_external' ? 'Dedicated' : 'Cloud shared'}
                  </div>
                  <div className="text-[11px] text-slate-500 mt-0.5">
                    {isExternalStorage
                      ? provider === 'cloudflare_r2'
                        ? 'Cloudflare R2'
                        : (provider ?? '').replace(/_/g, ' ')
                      : 'Supabase Storage'}
                  </div>
                  {bucketName ? (
                    <div
                      className="text-[10.5px] font-mono text-slate-400 mt-0.5 truncate max-w-[150px]"
                      title={bucketName}
                    >
                      {bucketName}
                    </div>
                  ) : null}
                </td>

                <td className="px-4 py-3.5 align-top">
                  <div className="text-[12.5px] font-semibold text-slate-800">
                    {licenseLabel(org.licenseType)}
                  </div>
                  <div className={`text-[11px] mt-0.5 ${expiryTone}`}>{expiry.label}</div>
                </td>

                <td className="px-4 py-3.5 align-top text-right font-mono text-[12.5px] tabular-nums text-slate-800">
                  {org.settings?.allowedUserSeats != null ? (
                    org.settings.allowedUserSeats
                  ) : (
                    <span className="text-[11px] font-sans italic text-slate-400">Unlimited</span>
                  )}
                </td>

                <td className="px-4 py-3.5 align-top text-right">
                  <div className="ml-auto w-fit min-w-[132px]">
                    {isExternalStorage ? (
                      <>
                        <div className="font-mono text-[12.5px] font-semibold tabular-nums text-emerald-700">
                          {byosConsumedBytes != null ? formatBytes(byosConsumedBytes) : '—'}
                          {byosQuotaGb != null ? (
                            <span className="text-slate-400 font-normal"> / {byosQuotaGb} GB</span>
                          ) : (
                            <span className="text-slate-400 font-normal font-sans italic"> / Unlimited</span>
                          )}
                        </div>
                        {byosPercent != null ? (
                          <div className="mt-1.5 ml-auto">
                            <UsageBar percent={byosPercent} />
                          </div>
                        ) : null}
                        <div className="text-[11px] text-slate-500 mt-1">
                          {provider === 'cloudflare_r2' ? 'Cloudflare R2 bucket' : 'External bucket'}
                          {byosPercent != null ? ` · ${formatPercent(byosPercent)} of plan` : ''}
                        </div>
                        <div className="text-[11px] text-slate-400 mt-1.5 pt-1.5 border-t border-slate-100">
                          Platform DB{' '}
                          {consumedBytes !== null ? (
                            <>
                              {formatBytes(consumedBytes)}
                              {allocatedGb != null ? ` of ${allocatedGb} GB` : ''} ·{' '}
                              {measuredCount(consumedFiles)} files
                            </>
                          ) : (
                            'not in the inventory'
                          )}
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="font-mono text-[12.5px] font-semibold tabular-nums text-slate-900">
                          {formatBytes(consumedBytes)}
                          {allocatedGb != null ? (
                            <span className="text-slate-400 font-normal"> / {allocatedGb} GB</span>
                          ) : null}
                        </div>
                        {headPercent != null ? (
                          <div className="mt-1.5 ml-auto">
                            <UsageBar percent={headPercent} />
                          </div>
                        ) : null}
                        <div className="text-[11px] text-slate-500 mt-1">
                          {measuredCount(consumedFiles)} files
                          {percentUsed != null ? ` · ${formatPercent(percentUsed)} of quota` : ''}
                        </div>
                      </>
                    )}
                  </div>
                </td>

                <td className="px-4 py-3.5 align-top text-right">
                  {isStorageLoading && !storageError ? (
                    <div className="ml-auto w-fit space-y-1.5 animate-pulse">
                      <div className="h-3 w-24 bg-slate-100 rounded" />
                      <div className="h-3 w-20 bg-slate-100 rounded" />
                    </div>
                  ) : row ? (
                    <div className="ml-auto w-fit space-y-0.5">
                      {bucketLines(row).map((bucket) => (
                        <div key={bucket.label} className="flex items-baseline justify-end gap-2.5">
                          <span className="w-[64px] text-right text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                            {bucket.label}
                          </span>
                          <span className="font-mono text-[11.5px] tabular-nums text-slate-700">
                            {formatBytes(bucket.bytes)}
                            <span className="text-[10px] text-slate-400">
                              {' '}
                              ({bucket.files == null ? '—' : bucket.files.toLocaleString()})
                            </span>
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <span className="text-[11px] italic text-slate-400">Not in the inventory</span>
                  )}
                </td>

                <td className="px-4 py-3.5 align-top">
                  <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-slate-700 capitalize">
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${STATUS_DOT[org.status]}`} />
                    {org.status}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>

    <p className="text-[11px] text-slate-400 mt-3 leading-relaxed">
      Bucket figures are bytes stored, with the file count in parentheses. A dash means the figure was not measured.
    </p>
  </>
);

/**
 * The licence expiry label lives in `consoleLicenseStatus.ts` so that the
 * dashboard, the company directory and the database hub all render it from one
 * place.
 */
export default ConsoleCompanyStorageTable;
