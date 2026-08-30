// =====================================================================
// Printable PDF-style report builders for the Reports workspace.
// These are independent of the dashboard's executive generator (which
// stays untouched to guarantee zero regression on the dashboard button).
// =====================================================================

import type { SurveyAnalytics } from './surveyAnalytics';

export interface ReportMeta {
  operator?: string;
  generatedBy?: string;
}

const CSS = `
@page { size: A4 portrait; margin: 12mm 15mm 15mm 15mm; }
* { box-sizing: border-box; }
body {
  font-family: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  color: #0f172a; background: #ffffff; margin: 0; padding: 24px; font-size: 11px; line-height: 1.5;
  -webkit-print-color-adjust: exact; print-color-adjust: exact;
}
.action-bar { display: flex; justify-content: space-between; align-items: center; background: #0f172a; color: #ffffff; padding: 12px 20px; margin: -24px -24px 24px -24px; }
.action-bar-title { font-weight: 700; font-size: 13px; letter-spacing: 0.5px; }
.print-btn { background: #ffffff; color: #0f172a; border: none; padding: 7px 16px; font-size: 11px; font-weight: 700; border-radius: 4px; cursor: pointer; text-transform: uppercase; letter-spacing: 0.5px; }
.print-btn:hover { background: #e2e8f0; }
.doc-header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #0f172a; padding-bottom: 14px; margin-bottom: 16px; }
.org-title { font-size: 10px; font-weight: 800; letter-spacing: 1.5px; color: #475569; text-transform: uppercase; margin-bottom: 2px; }
.main-title { font-size: 20px; font-weight: 800; color: #0f172a; margin: 0 0 4px 0; letter-spacing: -0.3px; }
.sub-title { font-size: 12px; font-weight: 600; color: #334155; }
.doc-meta-box { background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 4px; padding: 8px 12px; font-size: 10px; min-width: 240px; }
.meta-row { display: flex; justify-content: space-between; gap: 16px; }
.meta-label { color: #64748b; }
.meta-value { font-weight: 700; color: #0f172a; }
.section { margin-bottom: 18px; }
.section-title { font-size: 12px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.8px; color: #0f172a; border-bottom: 1px solid #cbd5e1; padding-bottom: 5px; margin-bottom: 8px; }
.kpi-grid { display: grid; grid-template-columns: repeat(6, 1fr); gap: 8px; margin-bottom: 12px; }
.kpi { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 8px 10px; }
.kpi-label { font-size: 8px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.5px; color: #64748b; }
.kpi-value { font-size: 15px; font-weight: 800; color: #0f172a; margin-top: 2px; }
.kpi-sub { font-size: 9px; color: #64748b; margin-top: 2px; }
table { width: 100%; border-collapse: collapse; font-size: 10px; }
th { background: #f1f5f9; text-align: left; padding: 6px 8px; font-size: 8.5px; text-transform: uppercase; letter-spacing: 0.5px; color: #475569; border: 1px solid #e2e8f0; }
td { padding: 5px 8px; border: 1px solid #e2e8f0; }
tr:nth-child(even) td { background: #f8fafc; }
.text-right { text-align: right; }
.text-center { text-align: center; }
.badge { display: inline-block; padding: 1px 7px; border-radius: 999px; font-size: 8.5px; font-weight: 700; text-transform: uppercase; }
.badge-ok { background: #d1fae5; color: #065f46; }
.badge-warn { background: #fef3c7; color: #92400e; }
.badge-danger { background: #fee2e2; color: #991b1b; }
.badge-info { background: #dbeafe; color: #1e40af; }
.doc-footer { border-top: 1px solid #cbd5e1; margin-top: 20px; padding-top: 8px; display: flex; justify-content: space-between; font-size: 9px; color: #64748b; }
.note { font-size: 9.5px; color: #64748b; margin-top: 4px; }
`;

function refNumber(kind: string): string {
  const now = new Date();
  const d = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
  return `GEO-MMS-${kind}-${d}-${Math.floor(1000 + Math.random() * 9000)}`;
}

function isoNow(): string {
  const now = new Date();
  return (
    now.toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' }) +
    ' • ' +
    now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
  );
}

export function reportShell(title: string, subtitle: string, refNo: string, bodyHtml: string, meta?: ReportMeta): string {
  const operator = meta?.operator || 'GIS Engineer';
  const generatedBy = meta?.generatedBy || 'GeoSphere 360 · Executive Processing Dashboard';
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${title}</title>
  <style>${CSS}</style>
</head>
<body>
  <div class="action-bar">
    <div class="action-bar-title">GeoSphere 360 Reporting Console</div>
    <button class="print-btn" onclick="window.print()">Print / Save PDF</button>
  </div>

  <div class="doc-header">
    <div>
      <div class="org-title">GeoSphere 360 Project Surveillance</div>
      <h1 class="main-title">${title}</h1>
      <div class="sub-title">${subtitle}</div>
    </div>
    <div class="doc-meta-box">
      <div class="meta-row"><span class="meta-label">Document No.</span><span class="meta-value">${refNo}</span></div>
      <div class="meta-row"><span class="meta-label">Date</span><span class="meta-value">${isoNow()}</span></div>
      <div class="meta-row"><span class="meta-label">Operator</span><span class="meta-value">${operator}</span></div>
      <div class="meta-row"><span class="meta-label">Generated By</span><span class="meta-value">${generatedBy}</span></div>
    </div>
  </div>

  ${bodyHtml}

  <div class="doc-footer">
    <div>STRICTLY CONFIDENTIAL</div>
    <div>Page 1 of 1 • ${title}</div>
  </div>
</body>
</html>`;
}

export function openPrintableReport(_title: string, html: string): void {
  const w = window.open('', '_blank', 'width=1000,height=1100');
  if (!w) return;
  w.document.write(html);
  w.document.close();
}

function esc(v: unknown): string {
  return String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function stateBadge(state: string): string {
  if (state === 'published') return '<span class="badge badge-ok">PUBLISHED</span>';
  if (state === 'staged') return '<span class="badge badge-info">STAGED</span>';
  if (state === 'partial') return '<span class="badge badge-warn">PARTIAL</span>';
  return '<span class="badge badge-danger">NONE</span>';
}

// ---------------------------------------------------------------------
// 1. Executive Progress & Quality Audit Report
// ---------------------------------------------------------------------
export function buildExecutiveReportHtml(analytics: SurveyAnalytics, meta?: ReportMeta): string {
  const t = analytics.totals;
  const body = `
    <div class="section">
      <div class="section-title">Programme KPIs</div>
      <div class="kpi-grid">
        <div class="kpi"><div class="kpi-label">Subgrids Surveyed</div><div class="kpi-value">${t.subgrids}</div><div class="kpi-sub">${t.published} published · ${t.staged} staged</div></div>
        <div class="kpi"><div class="kpi-label">Distance Captured</div><div class="kpi-value">${t.km.toFixed(2)} km</div><div class="kpi-sub">${t.targetProgressKmPct.toFixed(1)}% of ${t.targetKm.toFixed(1)} km target</div></div>
        <div class="kpi"><div class="kpi-label">Processed Frames</div><div class="kpi-value">${t.frames.toLocaleString()}</div><div class="kpi-sub">${t.captureFrames.toLocaleString()} RAW captures</div></div>
        <div class="kpi"><div class="kpi-label">POIs Registered</div><div class="kpi-value">${t.poi.toLocaleString()}</div><div class="kpi-sub">${analytics.dailySeries.length} capture days</div></div>
        <div class="kpi"><div class="kpi-label">Defects Detected</div><div class="kpi-value">${t.defects.toLocaleString()}</div><div class="kpi-sub">${(100 - t.passRate).toFixed(1)}% defect rate</div></div>
        <div class="kpi"><div class="kpi-label">Quality Pass Rate</div><div class="kpi-value">${t.passRate.toFixed(1)}%</div><div class="kpi-sub">${t.qaApproved} approved · ${t.qaRejected} rejected</div></div>
      </div>
      <div class="note">Quality pass rate is computed per POI. Capture images target excludes the ${t.frames.toLocaleString()} processed frames; reconciliation with the RAW staging registry keeps the audit trail consistent.</div>
    </div>

    <div class="section">
      <div class="section-title">Subgrid Delivery Status</div>
      <table>
        <thead>
          <tr>
            <th>Subgrid</th><th class="text-right">Distance (km)</th><th class="text-right">POI</th><th class="text-right">Frames</th>
            <th class="text-right">Coverage</th><th class="text-right">Defects</th><th class="text-right">Pass Rate</th><th class="text-center">State</th>
          </tr>
        </thead>
        <tbody>
          ${analytics.perSubgrid.map((r) => `
            <tr>
              <td><strong>${esc(r.subgrid)}</strong></td>
              <td class="text-right">${r.km.toFixed(2)}</td>
              <td class="text-right">${r.poi.toLocaleString()}</td>
              <td class="text-right">${r.frames.toLocaleString()}</td>
              <td class="text-right">${r.coveragePct.toFixed(0)}%</td>
              <td class="text-right">${r.defects.toLocaleString()}</td>
              <td class="text-right">${r.passRate.toFixed(0)}%</td>
              <td class="text-center">${stateBadge(r.publishState)}</td>
            </tr>`).join('') || '<tr><td colspan="8">No survey batches yet.</td></tr>'}
        </tbody>
      </table>
    </div>

    <div class="section">
      <div class="section-title">Capture Gaps &amp; Risks</div>
      ${analytics.gaps.length === 0
        ? '<div class="note">No capture gaps detected — every surveyed subgrid is fully covered and published.</div>'
        : `<table>
          <thead><tr><th>Type</th><th>Subgrid</th><th>Detail</th></tr></thead>
          <tbody>
            ${analytics.gaps.map((g) => `
              <tr>
                <td><span class="${g.kind === 'missing_frames' ? 'badge badge-danger' : 'badge badge-warn'}">${g.kind.toUpperCase().replace(/_/g, ' ')}</span></td>
                <td><strong>${esc(g.subgrid)}</strong></td>
                <td>${esc(g.detail)}</td>
              </tr>`).join('')}
          </tbody>
        </table>`}
    </div>

    <div class="section">
      <div class="section-title">Daily Throughput Trend</div>
      <table>
        <thead><tr><th>Date</th><th class="text-right">Distance (km)</th><th class="text-right">POI</th><th class="text-right">Frames</th><th class="text-right">Defects</th></tr></thead>
        <tbody>
          ${analytics.dailySeries.map((d) => `
            <tr>
              <td>${esc(d.date)}</td>
              <td class="text-right">${d.km.toFixed(2)}</td>
              <td class="text-right">${d.poi.toLocaleString()}</td>
              <td class="text-right">${d.frames.toLocaleString()}</td>
              <td class="text-right">${d.defects.toLocaleString()}</td>
            </tr>`).join('') || '<tr><td colspan="5">No daily runs recorded.</td></tr>'}
        </tbody>
      </table>
    </div>
  `;
  return reportShell('Executive Progress & Quality Audit Report', 'Project-wide KPI summary over all surveyed subgrids', refNumber('EXEC'), body, meta);
}

// ---------------------------------------------------------------------
// 2. Daily Operations Report
// ---------------------------------------------------------------------
export interface DailyRowLike {
  date?: string;
  grid?: string;
  subgrid?: string;
  addImageCount?: number;
  images?: number;
  snapshotImageCount?: number;
  mapLocationName?: string;
  kmProcessed?: number;
  defects?: number;
  status?: string;
  captureEquipment?: string;
  pic?: string;
  isSyncedWithSupabase?: boolean;
}

export function buildDailyReportHtml(daily: DailyRowLike[], meta?: ReportMeta): string {
  const totalKm = Math.round(daily.reduce((a, b) => a + (b.kmProcessed || 0), 0) * 100) / 100;
  const totalPoi = daily.reduce((a, b) => a + (b.addImageCount || b.images || 0), 0);
  const totalFrames = daily.reduce((a, b) => a + (b.snapshotImageCount || b.images || 0), 0);
  const totalDefects = daily.reduce((a, b) => a + (b.defects || 0), 0);

  const body = `
    <div class="section">
      <div class="section-title">Daily Totals</div>
      <div class="kpi-grid">
        <div class="kpi"><div class="kpi-label">Days Logged</div><div class="kpi-value">${daily.length}</div><div class="kpi-sub">daily handover records</div></div>
        <div class="kpi"><div class="kpi-label">Distance</div><div class="kpi-value">${totalKm.toFixed(2)} km</div><div class="kpi-sub">cumulative captured</div></div>
        <div class="kpi"><div class="kpi-label">POIs</div><div class="kpi-value">${totalPoi.toLocaleString()}</div><div class="kpi-sub">added across days</div></div>
        <div class="kpi"><div class="kpi-label">Frames</div><div class="kpi-value">${totalFrames.toLocaleString()}</div><div class="kpi-sub">processed frames</div></div>
        <div class="kpi"><div class="kpi-label">Defects</div><div class="kpi-value">${totalDefects.toLocaleString()}</div><div class="kpi-sub">flagged during QA</div></div>
        <div class="kpi"><div class="kpi-label">Coverage</div><div class="kpi-value">${totalPoi > 0 ? ((totalFrames / totalPoi) * 100).toFixed(1) : '0'}%</div><div class="kpi-sub">frames per POI</div></div>
      </div>
    </div>

    <div class="section">
      <div class="section-title">Daily Operations Log</div>
      <table>
        <thead>
          <tr>
            <th>Date</th><th>Grid / Subgrid</th><th class="text-right">POI Added</th><th class="text-right">Frames</th>
            <th class="text-right">Distance (km)</th><th class="text-right">Defects</th><th>Equipment</th><th>PIC</th><th class="text-center">DB Sync</th>
          </tr>
        </thead>
        <tbody>
          ${daily.length === 0
            ? '<tr><td colspan="9">No daily handover records yet.</td></tr>'
            : daily.map((b) => `
            <tr>
              <td>${esc((b.date || '').slice(0, 10))}</td>
              <td>${esc(b.grid || '')} <strong>${esc(b.subgrid || '')}</strong></td>
              <td class="text-right">${(b.addImageCount || b.images || 0).toLocaleString()}</td>
              <td class="text-right">${(b.snapshotImageCount || b.images || 0).toLocaleString()}</td>
              <td class="text-right">${(b.kmProcessed || 0).toFixed(2)}</td>
              <td class="text-right">${(b.defects || 0).toLocaleString()}</td>
              <td>${esc(b.captureEquipment || 'MMS')}</td>
              <td>${esc(b.pic || '')}</td>
              <td class="text-center">${b.isSyncedWithSupabase || b.status === 'Complete' ? '<span class="badge badge-ok">SYNCED</span>' : '<span class="badge badge-warn">PENDING</span>'}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>
  `;
  return reportShell('Daily Operations Report', 'Daily field capture & handover register', refNumber('DAILY'), body, meta);
}

// ---------------------------------------------------------------------
// 3. Subgrid Coverage Report
// ---------------------------------------------------------------------
export function buildSubgridReportHtml(analytics: SurveyAnalytics, meta?: ReportMeta): string {
  const body = `
    <div class="section">
      <div class="section-title">Coverage &amp; Publication Summary</div>
      <div class="kpi-grid">
        <div class="kpi"><div class="kpi-label">Subgrids</div><div class="kpi-value">${analytics.totals.subgrids}</div><div class="kpi-sub">survey parcels</div></div>
        <div class="kpi"><div class="kpi-label">Published</div><div class="kpi-value">${analytics.totals.published}</div><div class="kpi-sub">synced to database</div></div>
        <div class="kpi"><div class="kpi-label">Staged</div><div class="kpi-value">${analytics.totals.staged}</div><div class="kpi-sub">awaiting publication</div></div>
        <div class="kpi"><div class="kpi-label">Partial</div><div class="kpi-value">${analytics.totals.partial}</div><div class="kpi-sub">incomplete delivery</div></div>
        <div class="kpi"><div class="kpi-label">Frames</div><div class="kpi-value">${analytics.totals.frames.toLocaleString()}</div><div class="kpi-sub">processed</div></div>
        <div class="kpi"><div class="kpi-label">POIs</div><div class="kpi-value">${analytics.totals.poi.toLocaleString()}</div><div class="kpi-sub">registered</div></div>
      </div>
    </div>

    <div class="section">
      <div class="section-title">Subgrid Coverage Matrix</div>
      <table>
        <thead>
          <tr>
            <th>Subgrid</th><th class="text-right">POI</th><th class="text-right">Frames Produced</th><th class="text-right">Coverage %</th>
            <th class="text-right">RAW Captured</th><th class="text-right">Missing</th><th class="text-center">State</th>
          </tr>
        </thead>
        <tbody>
          ${analytics.perSubgrid.map((r) => {
            const ag = analytics.gaps.find((g) => g.subgrid === r.subgrid && g.kind === 'missing_frames');
            return `<tr>
              <td><strong>${esc(r.subgrid)}</strong></td>
              <td class="text-right">${r.poi.toLocaleString()}</td>
              <td class="text-right">${r.frames.toLocaleString()}</td>
              <td class="text-right">${r.coveragePct.toFixed(0)}%</td>
              <td class="text-right">${r.captureFrames.toLocaleString()}</td>
              <td class="text-right">${ag && ag.missing ? ag.missing.toLocaleString() : '0'}</td>
              <td class="text-center">${stateBadge(r.publishState)}</td>
            </tr>`;
          }).join('') || '<tr><td colspan="7">No survey batches yet.</td></tr>'}
        </tbody>
      </table>
      <div class="note">Coverage % = processed frames ÷ registered POIs. Missing = POI target not yet backed by a deliverable frame.</div>
    </div>
  `;
  return reportShell('Subgrid Coverage Report', 'Per-parcel delivery, coverage and publication state', refNumber('COVER'), body, meta);
}

// ---------------------------------------------------------------------
// 4. QA/QC Audit Report
// ---------------------------------------------------------------------
export interface QaReportInput {
  jobs: Array<{ subgrid?: string; job_type?: string; status?: string; qa_decision?: string | null; qa_by?: string; qa_at?: string | null; completed_at?: string | null; name?: string }>;
  analytics: SurveyAnalytics;
}

export function buildQaReportHtml(input: QaReportInput, meta?: ReportMeta): string {
  const { jobs, analytics } = input;
  const decided = jobs.filter((j) => j.qa_decision);
  const approved = decided.filter((j) => j.qa_decision === 'APPROVED').length;
  const rejected = decided.filter((j) => j.qa_decision === 'REJECTED').length;

  const body = `
    <div class="section">
      <div class="section-title">QA Summary</div>
      <div class="kpi-grid">
        <div class="kpi"><div class="kpi-label">Jobs Reviewed</div><div class="kpi-value">${decided.length}</div><div class="kpi-sub">QA decisions logged</div></div>
        <div class="kpi"><div class="kpi-label">Approved</div><div class="kpi-value">${approved}</div><div class="kpi-sub">passed QC</div></div>
        <div class="kpi"><div class="kpi-label">Rejected</div><div class="kpi-value">${rejected}</div><div class="kpi-sub">returned to queue</div></div>
        <div class="kpi"><div class="kpi-label">Approval Rate</div><div class="kpi-value">${decided.length > 0 ? ((approved / decided.length) * 100).toFixed(1) : '100'}%</div><div class="kpi-sub">of reviewed jobs</div></div>
        <div class="kpi"><div class="kpi-label">Defect Flags</div><div class="kpi-value">${analytics.totals.defects.toLocaleString()}</div><div class="kpi-sub">across subgrids</div></div>
        <div class="kpi"><div class="kpi-label">Pass Rate</div><div class="kpi-value">${analytics.totals.passRate.toFixed(1)}%</div><div class="kpi-sub">per POI</div></div>
      </div>
    </div>

    <div class="section">
      <div class="section-title">QA Decision Log</div>
      <table>
        <thead>
          <tr><th>Job</th><th>Type</th><th>Subgrid</th><th>Decision</th><th>Reviewed By</th><th>Reviewed At</th></tr>
        </thead>
        <tbody>
          ${decided.length === 0
            ? '<tr><td colspan="6">No QA decisions recorded yet.</td></tr>'
            : decided.sort((a, b) => (b.qa_at || b.completed_at || '').localeCompare(a.qa_at || a.completed_at || '')).map((j) => `
            <tr>
              <td>${esc(j.name || j.job_type || 'Job')}</td>
              <td>${esc(j.job_type || '')}</td>
              <td>${esc(j.subgrid || '')}</td>
              <td>${j.qa_decision === 'APPROVED' ? '<span class="badge badge-ok">APPROVED</span>' : '<span class="badge badge-danger">REJECTED</span>'}</td>
              <td>${esc(j.qa_by || '')}</td>
              <td>${esc((j.qa_at || j.completed_at || '').slice(0, 16))}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>

    <div class="section">
      <div class="section-title">Defect Register by Subgrid</div>
      <table>
        <thead><tr><th>Subgrid</th><th class="text-right">Defects</th><th class="text-right">Defects per km</th><th class="text-right">Pass Rate</th><th class="text-center">QA Approved / Rejected</th></tr></thead>
        <tbody>
          ${analytics.perSubgrid.filter((r) => r.defects > 0 || r.qaRejected > 0).map((r) => `
            <tr>
              <td><strong>${esc(r.subgrid)}</strong></td>
              <td class="text-right">${r.defects.toLocaleString()}</td>
              <td class="text-right">${r.defectsPerKm.toFixed(2)}</td>
              <td class="text-right">${r.passRate.toFixed(0)}%</td>
              <td class="text-center">${r.qaApproved} / ${r.qaRejected}</td>
            </tr>`).join('') || '<tr><td colspan="5">No defects flagged.</td></tr>'}
        </tbody>
      </table>
    </div>
  `;
  return reportShell('QA/QC Audit Report', 'Quality assurance decisions and defect register', refNumber('QAQC'), body, meta);
}

// ---------------------------------------------------------------------
// 5. Lineage / Audit Trail Report
// ---------------------------------------------------------------------
export interface LineageReportInput {
  datasets: Array<{ name?: string; dataset_type?: string; pipeline_stage?: string; subgrid?: string; status?: string; created_by?: string; created_at?: string; file_count?: number }>;
  jobs: Array<{ name?: string; job_type?: string; subgrid?: string; status?: string; operator?: string; updated_at?: string }>;
}

export function buildLineageReportHtml(input: LineageReportInput, meta?: ReportMeta): string {
  const { datasets, jobs } = input;
  const body = `
    <div class="section">
      <div class="section-title">Dataset Registry</div>
      <table>
        <thead><tr><th>Dataset</th><th>Type</th><th>Stage</th><th>Subgrid</th><th class="text-right">Files</th><th>Status</th><th>Created By</th><th>Created At</th></tr></thead>
        <tbody>
          ${datasets.length === 0
            ? '<tr><td colspan="8">No datasets registered.</td></tr>'
            : [...datasets].sort((a, b) => (b.created_at || '').localeCompare(a.created_at || '')).map((d) => `
            <tr>
              <td><strong>${esc(d.name || '')}</strong></td>
              <td>${esc(d.dataset_type || '')}</td>
              <td>${esc(d.pipeline_stage || '')}</td>
              <td>${esc(d.subgrid || '')}</td>
              <td class="text-right">${(d.file_count || 0).toLocaleString()}</td>
              <td><span class="badge badge-info">${esc(d.status || '')}</span></td>
              <td>${esc(d.created_by || '')}</td>
              <td>${esc((d.created_at || '').slice(0, 16))}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>

    <div class="section">
      <div class="section-title">Processing Job Chain</div>
      <table>
        <thead><tr><th>Job</th><th>Type</th><th>Subgrid</th><th>Status</th><th>Operator</th><th>Updated At</th></tr></thead>
        <tbody>
          ${jobs.length === 0
            ? '<tr><td colspan="6">No processing jobs recorded.</td></tr>'
            : [...jobs].sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || '')).map((j) => `
            <tr>
              <td><strong>${esc(j.name || j.job_type || '')}</strong></td>
              <td>${esc(j.job_type || '')}</td>
              <td>${esc(j.subgrid || '')}</td>
              <td><span class="badge ${j.status === 'COMPLETED' || j.status === 'APPROVED' ? 'badge-ok' : j.status === 'FAILED' || j.status === 'REJECTED' ? 'badge-danger' : j.status === 'PENDING' || j.status === 'QUEUED' ? 'badge-info' : 'badge-warn'}">${esc(j.status || '')}</span></td>
              <td>${esc(j.operator || '')}</td>
              <td>${esc((j.updated_at || '').slice(0, 16))}</td>
            </tr>`).join('')}
        </tbody>
      </table>
      <div class="note">Audit trail: RAW capture → STITCH → BLUR → ENHANCE → MASK → QAQC → DELIVERABLE. Metadata reflects the reconciled Supabase registry.</div>
    </div>
  `;
  return reportShell('Lineage & Audit Trail Report', 'Dataset provenance and processing job chain', refNumber('LINEAGE'), body, meta);
}