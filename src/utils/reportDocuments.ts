// =====================================================================
// Printable PDF-style report builders for the Reports workspace.
// Audit-document layout modelled on classic scanner/enterprise report
// suites: Arial typography, teal numbered sections, an automatic table
// of contents, dark header-bar tables, CSS bar charts and a GeoSphere
// wordmark in the document header and footer. No KPI card stacks and
// no colour pills — every export reads as one cohesive audit document.
// Independent of the dashboard's executive generator (which stays
// untouched to guarantee zero regression on the dashboard button).
// =====================================================================

import type { SurveyAnalytics } from './surveyAnalytics';

export interface ReportMeta {
  operator?: string;
  generatedBy?: string;
  contractCode?: string;
  classification?: string;
  /** Trigger the print dialog once the preview window finishes loading. */
  autoPrint?: boolean;
}

const TEAL = '#00788a';
const TEAL_BRIGHT = '#00a3ad';

const CSS = `
@page { size: A4 portrait; margin: 16mm 16mm 18mm 16mm; }
* { box-sizing: border-box; }
html { background: #eef0f3; }
body {
  font-family: Arial, Helvetica, 'Noto Sans', 'Segoe UI', sans-serif;
  color: #262626; background: #ffffff; margin: 0 auto; padding: 30px 42px 26px;
  font-size: 10.5px; line-height: 1.55; max-width: 860px;
  -webkit-print-color-adjust: exact; print-color-adjust: exact;
}
td, th { font-variant-numeric: tabular-nums; }

/* Screen-only action bar — never part of the printed document */
.action-bar {
  display: flex; justify-content: space-between; align-items: center; gap: 12px;
  border-bottom: 1px solid #d9d9d9; padding: 0 0 14px; margin-bottom: 18px;
}
.action-bar-title { font-weight: 700; font-size: 10px; letter-spacing: 1px; text-transform: uppercase; color: #7a7a7a; }
.print-btn {
  background: ${TEAL}; color: #ffffff; border: none; padding: 7px 18px;
  font-size: 10px; font-weight: 700; border-radius: 2px; cursor: pointer;
  text-transform: uppercase; letter-spacing: 0.8px; font-family: inherit;
}
.print-btn:hover { background: #005f6e; }

/* Wordmark logo: GeoSphere dual-chevron flight mark + "GeoSphere 360°" */
.logo { display: inline-flex; align-items: center; }
.logo svg { display: block; }

/* Document masthead */
.doc-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 24px;
  border-bottom: 2px solid ${TEAL}; padding-bottom: 10px; margin-bottom: 4px; }
.doc-head-left { display: flex; flex-direction: column; gap: 12px; }
.doc-title-block .org-title { font-size: 8.5px; font-weight: 700; letter-spacing: 1.8px;
  color: #7a7a7a; text-transform: uppercase; margin-bottom: 3px; }
.main-title { font-size: 17px; font-weight: 700; color: ${TEAL}; margin: 0 0 2px 0; line-height: 1.25; }
.sub-title { font-size: 10px; color: #7a7a7a; }
.doc-meta { font-size: 8.5px; color: #7a7a7a; text-align: right; line-height: 1.9; white-space: nowrap; }
.doc-meta strong { color: #262626; font-weight: 700; }

/* Table of contents */
.toc { margin: 22px 0 26px 0; }
.toc-title { font-size: 14px; font-weight: 700; color: ${TEAL}; margin-bottom: 8px; }
.toc-item { padding: 2px 0 2px 14px; font-size: 10.5px; color: #262626; }
.toc-item .toc-n { display: inline-block; min-width: 22px; font-weight: 700; color: ${TEAL}; }

/* Sections — teal numbered headings with grey captions */
.section { margin-bottom: 22px; }
.sec-h { font-size: 12.5px; font-weight: 700; color: ${TEAL}; margin-bottom: 2px; }
.sec-h .sec-num { display: inline-block; min-width: 24px; }
.sec-cap { font-size: 8.5px; color: #7a7a7a; margin: 0 0 8px 24px; }
.para { margin: 0 0 8px 0; color: #262626; }
.note { font-size: 8.5px; color: #7a7a7a; margin-top: 6px; line-height: 1.6; }

/* Tables — dark teal header bar, hairline rows */
table { width: 100%; border-collapse: collapse; }
table.summary, table.data { margin-bottom: 2px; }
th { background: ${TEAL}; color: #ffffff; text-align: left; padding: 5px 8px;
  font-size: 8.5px; font-weight: 700; letter-spacing: 0.4px; }
td { padding: 4.5px 8px; border-bottom: 1px solid #e3e6e8; font-size: 10px; color: #262626; }
tr { page-break-inside: avoid; }
tfoot td { border-top: 2px solid ${TEAL}; border-bottom: none; font-weight: 700; background: #f2f6f7; }
.text-right { text-align: right; }
.text-center { text-align: center; }
.sub { font-size: 9px; color: #5f5f5f; }
.st { font-size: 9px; font-weight: 700; letter-spacing: 0.3px; text-transform: uppercase; color: #262626; }
.st-mute { color: #8a8f94; font-weight: 400; }

/* CSS bar chart — teal bars on a hairline plot */
.chart { border: 1px solid #d9d9d9; border-top: 3px solid ${TEAL}; padding: 12px 12px 6px; margin: 4px 0 6px; }
.chart-title { font-size: 9px; font-weight: 700; color: #262626; margin-bottom: 10px; }
.chart-plot { display: flex; align-items: flex-end; height: 140px; gap: 6px; }
.bar-col { flex: 1; display: flex; flex-direction: column; justify-content: flex-end; align-items: stretch; height: 100%; min-width: 0; }
.bar { background: ${TEAL_BRIGHT}; border-top: 2px solid ${TEAL}; }
.bar-x { font-size: 7px; color: #5f5f5f; text-align: center; margin-top: 4px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

/* Sign-off grid */
.signoff-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; page-break-inside: avoid; margin-top: 10px; }
.signoff-box { border: 1px solid #d9d9d9; border-top: 3px solid ${TEAL}; padding: 10px 12px; }
.signoff-role { font-size: 8.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.6px;
  color: #1b2430; border-bottom: 1px solid #e3e6e8; padding-bottom: 5px; margin-bottom: 12px; }
.signoff-line { border-bottom: 1px solid #262626; height: 30px; margin-bottom: 8px; }
.signoff-meta { font-size: 8.5px; color: #5f5f5f; line-height: 1.6; }
.signoff-meta strong { color: #262626; }

.doc-footer { border-top: 1px solid #d9d9d9; margin-top: 26px; padding-top: 10px; display: flex;
  justify-content: space-between; align-items: center; font-size: 8.5px; color: #7a7a7a; }
.doc-footer .foot-doc { text-align: right; line-height: 1.6; }

thead { display: table-header-group; }
h1, h2, h3 { page-break-after: avoid; }

@media print {
  html, body { background: #ffffff; }
  body { padding: 0; max-width: none; }
  .action-bar { display: none !important; }
}
`;

// GeoSphere 360° full brand mark (public/branding/geosphere-full-logo.svg),
// adapted for white paper: dark-grey chevron flight mark, grey→ink gradient
// word text and dark "360°" matching the ink tone.
function logoSVG(height: number): string {
  return `<svg height="${height}" viewBox="0 0 820 200" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="GeoSphere 360°">
  <defs>
    <linearGradient id="gs-word" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#6b7280"/>
      <stop offset="100%" stop-color="#1b2430"/>
    </linearGradient>
  </defs>
  <path d="M 189 11 C 145.3 24.9, 77.7 15.0, 62 67 C 89.0 65.7, 118.7 56.0, 147 52 Z" fill="#1b2430" opacity="0.65"/>
  <path d="M 189 11 L 147 52 C 145.6 80.5, 135.4 109.0, 132 138 C 186.3 122.4, 175.4 54.6, 189 11 Z" fill="#1b2430" opacity="0.45"/>
  <path d="M 137 63 C 93.3 76.9, 25.7 67.0, 10 119 C 37.0 117.7, 66.7 108.0, 95 104 Z" fill="#1b2430"/>
  <path d="M 137 63 L 95 104 C 93.6 132.5, 83.4 161.0, 80 190 C 134.3 174.4, 123.4 106.6, 137 63 Z" fill="#1b2430" opacity="0.8"/>
  <g transform="translate(220, 108)">
    <text y="0" dominant-baseline="central" font-family="Arial, Helvetica, sans-serif" font-weight="800" font-size="78" letter-spacing="-1">
      <tspan fill="url(#gs-word)">GeoSphere</tspan><tspan font-weight="700" font-size="70" dx="14" fill="#1b2430">360&#176;</tspan>
    </text>
  </g>
</svg>`;
}

function logo(sm?: boolean): string {
  return `<span class="logo">${logoSVG(sm ? 16 : 34)}</span>`;
}

export function refNumber(kind: string): string {
  const now = new Date();
  const d = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
  return `GEO-MMS-${kind}-${d}-${Math.floor(1000 + Math.random() * 9000)}`;
}

function isoNow(): string {
  const now = new Date();
  return (
    now.toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' }) +
    ' — ' +
    now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
  );
}

export interface ReportSection {
  /** Section number as rendered, e.g. "1" or "2.1". */
  n: string;
  /** Teal heading text (raw HTML allowed, already trusted). */
  title: string;
  /** Grey caption line under the heading. */
  caption?: string;
  /** Section body HTML. */
  body: string;
}

export function renderSections(sections: ReportSection[]): string {
  return sections.map((s) => `
    <div class="section">
      <div class="sec-h"><span class="sec-num">${esc(s.n)}</span>${s.title}</div>
      ${s.caption ? `<p class="sec-cap">${s.caption}</p>` : ''}
      ${s.body}
    </div>`).join('');
}

export function renderToc(sections: ReportSection[]): string {
  return `<div class="toc">
    <div class="toc-title">Table of Contents</div>
    ${sections.map((s) => `<div class="toc-item"><span class="toc-n">${esc(s.n)}</span>${s.title}</div>`).join('')}
  </div>`;
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
    <div class="action-bar-title">GeoSphere 360 · Reporting Console</div>
    <button class="print-btn" onclick="window.print()">Print / Save PDF</button>
  </div>

  <div class="doc-header">
    <div class="doc-head-left">
      ${logo()}
      <div class="doc-title-block">
        <div class="org-title">GeoSphere 360 · Mobile Mapping Surveillance</div>
        <h1 class="main-title">${title}</h1>
        <div class="sub-title">${subtitle}</div>
      </div>
    </div>
    <div class="doc-meta">
      <div>Document No. <strong>${refNo}</strong></div>
      <div>Date <strong>${isoNow()}</strong></div>
      <div>Prepared by <strong>${operator}</strong></div>
      <div>Source <strong>${generatedBy}</strong></div>
      ${meta?.contractCode ? `<div>Contract <strong>${esc(meta.contractCode)}</strong></div>` : ''}
      ${meta?.classification ? `<div>Classification <strong>${esc(meta.classification)}</strong></div>` : ''}
    </div>
  </div>

  ${bodyHtml}

  <div class="doc-footer">
    ${logo(true)}
    <div class="foot-doc"><strong>${title}</strong><br/>Strictly Confidential · ${refNo}</div>
  </div>
  ${meta?.autoPrint ? `<script>window.addEventListener('load', function(){ setTimeout(function(){ window.print(); }, 500); });</script>` : ''}
</body>
</html>`;
}

export function openPrintableReport(_title: string, html: string): void {
  const w = window.open('', '_blank', 'width=1000,height=1100');
  if (!w) return;
  w.document.write(html);
  w.document.close();
}

export function esc(v: unknown): string {
  return String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function cap(v: string): string {
  return v.charAt(0).toUpperCase() + v.slice(1).toLowerCase();
}

export function barChart(caption: string, points: Array<{ label: string; value: number }>, unit = ''): string {
  if (points.length === 0) return '';
  const max = Math.max(...points.map((p) => p.value), 1);
  return `<div class="chart">
    <div class="chart-title">${esc(caption)}</div>
    <div class="chart-plot">
      ${points.map((p) => `
        <div class="bar-col">
          <div class="bar" style="height:${Math.max(2, (p.value / max) * 100).toFixed(1)}%" title="${p.value.toLocaleString()}${esc(unit)}"></div>
          <div class="bar-x">${esc(p.label)}</div>
        </div>`).join('')}
    </div>
  </div>`;
}

// ---------------------------------------------------------------------
// 1. Executive Progress & Quality Audit Report
// ---------------------------------------------------------------------
export function buildExecutiveReportHtml(analytics: SurveyAnalytics, meta?: ReportMeta): string {
  const t = analytics.totals;
  const sections: ReportSection[] = [
    {
      n: '1',
      title: 'Executive Summary',
      caption: 'Project-wide progress and quality position over all surveyed subgrids.',
      body: `<p class="para">As of the reporting date, the programme has surveyed ${t.subgrids} subgrid ${t.subgrids === 1 ? 'cell' : 'cells'},
      capturing ${t.km.toFixed(2)} km of contract road${t.targetKm > 0 ? ` against a target of ${t.targetKm.toFixed(1)} km (${t.targetProgressKmPct.toFixed(1)}%)` : ''},
      with ${t.poi.toLocaleString()} POIs registered and ${t.frames.toLocaleString()} panorama frames processed.
      ${t.defects === 0
        ? 'No defect flags are outstanding and the quality pass rate stands at 100%.'
        : `${t.defects.toLocaleString()} defect flag${t.defects === 1 ? '' : 's'} remain${t.defects === 1 ? 's' : ''} across the survey, giving a quality pass rate of ${t.passRate.toFixed(1)}%.`}
      ${t.published} of ${t.subgrids} subgrids are published${t.staged > 0 ? `, ${t.staged} staged` : ''}${t.partial > 0 ? `, ${t.partial} partial` : ''}.</p>
      <table class="summary">
        <thead><tr><th>Metric</th><th>Figure</th><th>Remark</th></tr></thead>
        <tbody>
          <tr><td>Subgrids surveyed</td><td><strong>${t.subgrids}</strong></td><td class="sub">${t.published} published · ${t.staged} staged${t.partial > 0 ? ` · ${t.partial} partial` : ''}</td></tr>
          <tr><td>Distance captured</td><td><strong>${t.km.toFixed(2)} km</strong></td><td class="sub">${t.targetKm > 0 ? `${t.targetProgressKmPct.toFixed(1)}% of ${t.targetKm.toFixed(1)} km target` : 'No contract target registered'}</td></tr>
          <tr><td>Frames processed</td><td><strong>${t.frames.toLocaleString()}</strong></td><td class="sub">from ${t.captureFrames.toLocaleString()} RAW captures</td></tr>
          <tr><td>POIs registered</td><td><strong>${t.poi.toLocaleString()}</strong></td><td class="sub">${analytics.dailySeries.length} capture day${analytics.dailySeries.length === 1 ? '' : 's'} logged</td></tr>
          <tr><td>Defects detected</td><td><strong>${t.defects.toLocaleString()}</strong></td><td class="sub">${(100 - t.passRate).toFixed(1)}% defect rate</td></tr>
          <tr><td>Quality pass rate</td><td><strong>${t.passRate.toFixed(1)}%</strong></td><td class="sub">${t.qaApproved} approved · ${t.qaRejected} rejected</td></tr>
        </tbody>
      </table>
      <div class="note">All figures are reconciled against the Supabase registry at generation time. Quality pass rate is assessed per POI; image bytes remain on the NAS and are never embedded in this document.</div>`
    },
    {
      n: '2',
      title: 'Subgrid Delivery Status',
      caption: 'Per-parcel capture volume, quality position and publication state.',
      body: `<table class="data">
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
              <td class="text-center"><span class="st">${cap(r.publishState)}</span></td>
            </tr>`).join('') || '<tr><td colspan="8">No survey batches registered at the reporting date.</td></tr>'}
        </tbody>
        ${analytics.perSubgrid.length > 1 ? `<tfoot><tr>
          <td>Total</td>
          <td class="text-right">${t.km.toFixed(2)}</td>
          <td class="text-right">${t.poi.toLocaleString()}</td>
          <td class="text-right">${t.frames.toLocaleString()}</td>
          <td class="text-right">—</td>
          <td class="text-right">${t.defects.toLocaleString()}</td>
          <td class="text-right">${t.passRate.toFixed(0)}%</td>
          <td class="text-center">—</td>
        </tr></tfoot>` : ''}
      </table>`
    },
    {
      n: '3',
      title: 'Capture Gaps &amp; Risks',
      caption: 'Subgrids whose deliverable coverage falls short of the reconciled POI target.',
      body: analytics.gaps.length === 0
        ? '<p class="para">No capture gaps detected — every surveyed subgrid is fully covered and reconciled.</p>'
        : `<table class="data">
          <thead><tr><th>Type</th><th>Subgrid</th><th>Detail</th></tr></thead>
          <tbody>
            ${analytics.gaps.map((g) => `
              <tr>
                <td class="sub">${esc(cap(g.kind.replace(/_/g, ' ')))}</td>
                <td><strong>${esc(g.subgrid)}</strong></td>
                <td>${esc(g.detail)}</td>
              </tr>`).join('')}
          </tbody>
        </table>`
    },
    {
      n: '4',
      title: 'Daily Throughput',
      caption: 'Contract road captured per survey day.',
      body: `${barChart('Distance Captured by Day (km)', analytics.dailySeries.map((d) => ({ label: d.date.slice(5), value: d.km })), ' km')}
      <table class="data">
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
      </table>`
    }
  ];
  return reportShell('Executive Progress & Quality Audit Report', 'Project-wide KPI summary over all surveyed subgrids', refNumber('EXEC'), renderToc(sections) + renderSections(sections), meta);
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
  const synced = daily.filter((b) => b.isSyncedWithSupabase || b.status === 'Complete').length;

  const sections: ReportSection[] = [
    {
      n: '1',
      title: 'Summary of Figures',
      caption: 'Cumulative totals across all daily handover records.',
      body: `<table class="summary">
        <thead><tr><th>Metric</th><th>Figure</th><th>Remark</th></tr></thead>
        <tbody>
          <tr><td>Days logged</td><td><strong>${daily.length}</strong></td><td class="sub">${synced} synced · ${daily.length - synced} pending publication</td></tr>
          <tr><td>Distance</td><td><strong>${totalKm.toFixed(2)} km</strong></td><td class="sub">cumulative captured</td></tr>
          <tr><td>POIs added</td><td><strong>${totalPoi.toLocaleString()}</strong></td><td class="sub">${daily.length > 0 ? `avg. ${Math.round(totalPoi / daily.length).toLocaleString()} per day` : '—'}</td></tr>
          <tr><td>Frames processed</td><td><strong>${totalFrames.toLocaleString()}</strong></td><td class="sub">${totalPoi > 0 ? `${((totalFrames / totalPoi) * 100).toFixed(1)}% of POI target` : 'no POI target'}</td></tr>
          <tr><td>Defects flagged</td><td><strong>${totalDefects.toLocaleString()}</strong></td><td class="sub">during field and QA review</td></tr>
        </tbody>
      </table>`
    },
    {
      n: '2',
      title: 'Daily Operations Log',
      caption: 'Field capture and handover register, most recent first.',
      body: `<table class="data">
        <thead>
          <tr>
            <th>Date</th><th>Grid / Subgrid</th><th class="text-right">POI Added</th><th class="text-right">Frames</th>
            <th class="text-right">Distance (km)</th><th class="text-right">Defects</th><th>Equipment</th><th>PIC</th><th class="text-center">Sync</th>
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
              <td class="sub">${esc(b.captureEquipment || 'MMS')}</td>
              <td>${esc(b.pic || '')}</td>
              <td class="text-center"><span class="st${b.isSyncedWithSupabase || b.status === 'Complete' ? '' : ' st-mute'}">${b.isSyncedWithSupabase || b.status === 'Complete' ? 'Synced' : 'Pending'}</span></td>
            </tr>`).join('')}
        </tbody>
      </table>`
    }
  ];
  return reportShell('Daily Operations Report', 'Daily field capture & handover register', refNumber('DAILY'), renderToc(sections) + renderSections(sections), meta);
}

// ---------------------------------------------------------------------
// 3. Subgrid Coverage Report
// ---------------------------------------------------------------------
export function buildSubgridReportHtml(analytics: SurveyAnalytics, meta?: ReportMeta): string {
  const t = analytics.totals;
  const sections: ReportSection[] = [
    {
      n: '1',
      title: 'Coverage &amp; Publication Summary',
      caption: 'Programme totals behind the per-parcel matrix that follows.',
      body: `<table class="summary">
        <thead><tr><th>Metric</th><th>Figure</th><th>Remark</th></tr></thead>
        <tbody>
          <tr><td>Subgrids</td><td><strong>${t.subgrids}</strong></td><td class="sub">survey parcels in scope</td></tr>
          <tr><td>Published</td><td><strong>${t.published}</strong></td><td class="sub">reconciled and live</td></tr>
          <tr><td>Staged</td><td><strong>${t.staged}</strong></td><td class="sub">awaiting publication</td></tr>
          <tr><td>Partial</td><td><strong>${t.partial}</strong></td><td class="sub">incomplete delivery</td></tr>
          <tr><td>Frames produced</td><td><strong>${t.frames.toLocaleString()}</strong></td><td class="sub">against ${t.captureFrames.toLocaleString()} RAW captures</td></tr>
          <tr><td>POIs registered</td><td><strong>${t.poi.toLocaleString()}</strong></td><td class="sub">asset inspection points</td></tr>
        </tbody>
      </table>`
    },
    {
      n: '2',
      title: 'Coverage by Subgrid',
      caption: 'Processed frames as a percentage of registered POIs.',
      body: barChart('Coverage % by Subgrid', analytics.perSubgrid.map((r) => ({ label: r.subgrid, value: r.coveragePct })), '%')
        || '<p class="para">No survey batches registered at the reporting date.</p>'
    },
    {
      n: '3',
      title: 'Subgrid Coverage Matrix',
      caption: 'Full per-parcel delivery ledger with reconciliation gaps.',
      body: `<table class="data">
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
              <td class="text-center"><span class="st">${cap(r.publishState)}</span></td>
            </tr>`;
          }).join('') || '<tr><td colspan="7">No survey batches registered at the reporting date.</td></tr>'}
        </tbody>
      </table>
      <div class="note">Coverage % = processed frames ÷ registered POIs. Missing = POI target not yet backed by a deliverable frame.</div>`
    }
  ];
  return reportShell('Subgrid Coverage Report', 'Per-parcel delivery, coverage and publication state', refNumber('COVER'), renderToc(sections) + renderSections(sections), meta);
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
  const t = analytics.totals;
  const decided = [...jobs].filter((j) => j.qa_decision)
    .sort((a, b) => (b.qa_at || b.completed_at || '').localeCompare(a.qa_at || a.completed_at || ''));
  const approved = decided.filter((j) => j.qa_decision === 'APPROVED').length;
  const rejected = decided.filter((j) => j.qa_decision === 'REJECTED').length;

  const sections: ReportSection[] = [
    {
      n: '1',
      title: 'QA Summary',
      caption: 'Decision ledger totals and the per-POI quality position.',
      body: `<table class="summary">
        <thead><tr><th>Metric</th><th>Figure</th><th>Remark</th></tr></thead>
        <tbody>
          <tr><td>Jobs reviewed</td><td><strong>${decided.length}</strong></td><td class="sub">logged QA decisions</td></tr>
          <tr><td>Approved</td><td><strong>${approved}</strong></td><td class="sub">${decided.length > 0 ? `${((approved / decided.length) * 100).toFixed(1)}% approval rate` : '—'}</td></tr>
          <tr><td>Rejected</td><td><strong>${rejected}</strong></td><td class="sub">returned to the processing queue</td></tr>
          <tr><td>Defect flags</td><td><strong>${t.defects.toLocaleString()}</strong></td><td class="sub">across all surveyed subgrids</td></tr>
          <tr><td>Quality pass rate</td><td><strong>${t.passRate.toFixed(1)}%</strong></td><td class="sub">${t.qaApproved} POIs approved · ${t.qaRejected} rejected</td></tr>
        </tbody>
      </table>`
    },
    {
      n: '2',
      title: 'QA Decision Log',
      caption: 'Every recorded acceptance decision with reviewer and timestamp.',
      body: `<table class="data">
        <thead>
          <tr><th>Job</th><th>Type</th><th>Subgrid</th><th>Decision</th><th>Reviewed By</th><th>Reviewed At</th></tr>
        </thead>
        <tbody>
          ${decided.length === 0
            ? '<tr><td colspan="6">No QA decisions recorded yet.</td></tr>'
            : decided.map((j) => `
            <tr>
              <td><strong>${esc(j.name || j.job_type || 'Job')}</strong></td>
              <td class="sub">${esc(j.job_type || '')}</td>
              <td>${esc(j.subgrid || '')}</td>
              <td><span class="st${j.qa_decision === 'APPROVED' ? '' : ' st-mute'}">${esc(j.qa_decision || '')}</span></td>
              <td>${esc(j.qa_by || '')}</td>
              <td class="sub">${esc((j.qa_at || j.completed_at || '').slice(0, 16))}</td>
            </tr>`).join('')}
        </tbody>
      </table>`
    },
    {
      n: '3',
      title: 'Defect Register by Subgrid',
      caption: 'Subgrids carrying defect flags or rejected QA outcomes.',
      body: `<table class="data">
        <thead><tr><th>Subgrid</th><th class="text-right">Defects</th><th class="text-right">Defects per km</th><th class="text-right">Pass Rate</th><th class="text-right">QA Approved</th><th class="text-right">QA Rejected</th></tr></thead>
        <tbody>
          ${analytics.perSubgrid.filter((r) => r.defects > 0 || r.qaRejected > 0).map((r) => `
            <tr>
              <td><strong>${esc(r.subgrid)}</strong></td>
              <td class="text-right">${r.defects.toLocaleString()}</td>
              <td class="text-right">${r.defectsPerKm.toFixed(2)}</td>
              <td class="text-right">${r.passRate.toFixed(0)}%</td>
              <td class="text-right">${r.qaApproved}</td>
              <td class="text-right">${r.qaRejected}</td>
            </tr>`).join('') || '<tr><td colspan="6">No defects flagged during the review period.</td></tr>'}
        </tbody>
      </table>`
    }
  ];
  return reportShell('QA/QC Audit Report', 'Quality assurance decisions and defect register', refNumber('QAQC'), renderToc(sections) + renderSections(sections), meta);
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
  const sections: ReportSection[] = [
    {
      n: '1',
      title: 'Dataset Registry',
      caption: 'Registered datasets ordered by creation, newest first.',
      body: `<table class="data">
        <thead><tr><th>Dataset</th><th>Type</th><th>Stage</th><th>Subgrid</th><th class="text-right">Files</th><th>Status</th><th>Created By</th><th>Created At</th></tr></thead>
        <tbody>
          ${datasets.length === 0
            ? '<tr><td colspan="8">No datasets registered.</td></tr>'
            : [...datasets].sort((a, b) => (b.created_at || '').localeCompare(a.created_at || '')).map((d) => `
            <tr>
              <td><strong>${esc(d.name || '')}</strong></td>
              <td class="sub">${esc(d.dataset_type || '')}</td>
              <td class="sub">${esc(d.pipeline_stage || '')}</td>
              <td>${esc(d.subgrid || '')}</td>
              <td class="text-right">${(d.file_count || 0).toLocaleString()}</td>
              <td><span class="st">${esc(d.status || '')}</span></td>
              <td>${esc(d.created_by || '')}</td>
              <td class="sub">${esc((d.created_at || '').slice(0, 16))}</td>
            </tr>`).join('')}
        </tbody>
      </table>`
    },
    {
      n: '2',
      title: 'Processing Job Chain',
      caption: 'Pipeline jobs traced from RAW capture through to deliverables.',
      body: `<table class="data">
        <thead><tr><th>Job</th><th>Type</th><th>Subgrid</th><th>Status</th><th>Operator</th><th>Updated At</th></tr></thead>
        <tbody>
          ${jobs.length === 0
            ? '<tr><td colspan="6">No processing jobs recorded.</td></tr>'
            : [...jobs].sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || '')).map((j) => `
            <tr>
              <td><strong>${esc(j.name || j.job_type || '')}</strong></td>
              <td class="sub">${esc(j.job_type || '')}</td>
              <td>${esc(j.subgrid || '')}</td>
              <td><span class="st${['COMPLETED', 'APPROVED', 'FAILED', 'REJECTED'].includes(j.status || '') ? '' : ' st-mute'}">${esc(j.status || '')}</span></td>
              <td>${esc(j.operator || '')}</td>
              <td class="sub">${esc((j.updated_at || '').slice(0, 16))}</td>
            </tr>`).join('')}
        </tbody>
      </table>
      <div class="note">Pipeline order: RAW capture → Stitch → Blur → Enhance → Mask → QA/QC → Deliverable. Statuses reflect the reconciled Supabase registry at generation time. This document is metadata only — image bytes never leave the NAS.</div>`
    }
  ];
  return reportShell('Lineage & Audit Trail Report', 'Dataset provenance and processing job chain', refNumber('LINEAGE'), renderToc(sections) + renderSections(sections), meta);
}
