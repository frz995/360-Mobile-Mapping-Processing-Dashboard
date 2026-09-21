// Executive PDF report generated from the map dashboard action centre.
// Shares the audit-document shell (TOC, Arial, teal sections, GeoSphere
// brand mark) with the Reports workspace via utils/reportDocuments.

import { getPOICount, getImagesProcessedCount } from '../../utils/dashboardData';
import { extractSubgridName } from '../../utils/subgrid';
import type { BatchLog, AuditLogItem } from '../../types/dashboard';
import type { QAFlagState } from '../../hooks/useAppData';
import {
  reportShell,
  renderSections,
  renderToc,
  refNumber,
  esc,
  type ReportSection
} from '../../utils/reportDocuments';

export interface ProjectSettingsLike {
  targetKm?: number;
  targetImages?: number;
  contractCode?: string;
  dbAutoSyncSec?: number;
  cameraResolution?: string;
  imageStoragePath?: string;
  deliverableModel?: string;
  minGpsAccuracyM?: number;
  aiDefectThresholdPercent?: number;
  engineerName?: string;
  engineerTitle?: string;
  qaLeadName?: string;
  qaLeadTitle?: string;
  projectDirector?: string;
  contractorName?: string;
  directorTitle?: string;
}

export interface ExecutivePdfReportInput {
  batches: BatchLog[];
  auditLogs: AuditLogItem[];
  qaSubgridRecords: Record<string, QAFlagState>;
  projectSettings: ProjectSettingsLike;
  operatorUser: string;
}

export function buildExecutivePdfHtml(input: ExecutivePdfReportInput): string {
  const { batches: reportBatches, auditLogs, projectSettings, operatorUser, qaSubgridRecords } = input;
  const totalPoiCount = reportBatches.reduce((acc, b) => acc + getPOICount(b), 0);
  const totalPanoramasCount = reportBatches.reduce((acc, b) => acc + getImagesProcessedCount(b), 0);
  const totalKmVal = Math.round(reportBatches.reduce((acc, b) => acc + (b.kmProcessed || 0), 0) * 100) / 100;
  const totalDefectsCount = reportBatches.reduce((acc, b) => acc + (b.defects || 0), 0);
  const subgridsCount = reportBatches.length;
  const publishedCount = reportBatches.filter(b => b.isSyncedWithSupabase || b.status === 'Complete').length;
  const stagedCount = Math.max(0, subgridsCount - publishedCount);

  const passRateVal = totalPoiCount > 0
    ? (((totalPoiCount - totalDefectsCount) / totalPoiCount) * 100).toFixed(1)
    : '100.0';

  const targetKmVal = Number(projectSettings?.targetKm) || (totalKmVal > 0 ? totalKmVal : 0);
  const targetImagesVal = Number(projectSettings?.targetImages) || (totalPanoramasCount > 0 ? totalPanoramasCount : 0);
  const targetProgressPct = targetKmVal > 0 ? Math.min(100, (totalKmVal / targetKmVal) * 100).toFixed(1) : '0.0';
  const contractCode = projectSettings?.contractCode || 'MMS-2026-TNB-01';

  const now = new Date();
  const reportDate = now.toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' }) + ' — ' + now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

  const sections: ReportSection[] = [
    {
      n: '1',
      title: 'Executive Summary',
      caption: 'Validated progress, technical performance and QA position for the LV Asset Mapping initiative.',
      body: `<p class="para">This report presents the validated progress, technical performance and quality-assurance position of the
      Low Voltage (LV) Asset Mapping initiative under contract <strong>${esc(contractCode)}</strong>. As of <strong>${reportDate}</strong>,
      spatial data acquisition teams have mapped a cumulative trajectory of <strong>${totalKmVal.toFixed(2)} km</strong> across
      <strong>${subgridsCount} active subgrid${subgridsCount === 1 ? '' : 's'}</strong>, capturing
      <strong>${totalPoiCount.toLocaleString()} POI points</strong> and <strong>${totalPanoramasCount.toLocaleString()} verified 360° panorama frames</strong>.
      Feature detection and manual QC review confirm an overall quality health rating of <strong>${passRateVal}%</strong>, with
      <strong>${totalDefectsCount}</strong> defect ${totalDefectsCount === 1 ? 'anomaly' : 'anomalies'} (blurry lens frames, sun flare/obstructions or GPS drift spikes)
      logged and reconciled. All verified spatial geometries synchronize with the enterprise Supabase PostGIS database layer.</p>
      <table class="summary">
        <thead><tr><th>Metric</th><th>Figure</th><th>Remark</th></tr></thead>
        <tbody>
          <tr><td>Subgrids processed</td><td><strong>${subgridsCount}</strong></td><td class="sub">${publishedCount} verified &amp; published · ${stagedCount} staged in process</td></tr>
          <tr><td>Survey trajectory</td><td><strong>${totalKmVal.toFixed(2)} km</strong></td><td class="sub">${targetProgressPct}% of ${targetKmVal.toFixed(1)} km target</td></tr>
          <tr><td>360° panoramas</td><td><strong>${totalPanoramasCount.toLocaleString()}</strong></td><td class="sub">target ${targetImagesVal.toLocaleString()} frames</td></tr>
          <tr><td>POI points captured</td><td><strong>${totalPoiCount.toLocaleString()}</strong></td><td class="sub">asset inspection positions</td></tr>
          <tr><td>QA defects flagged</td><td><strong>${totalDefectsCount.toLocaleString()}</strong></td><td class="sub">${(100 - parseFloat(passRateVal)).toFixed(2)}% defect rate</td></tr>
          <tr><td>Data quality health</td><td><strong>${passRateVal}%</strong></td><td class="sub">status: QA benchmark ${parseFloat(passRateVal) >= 90 ? 'passed' : 'review required'}</td></tr>
          <tr><td>PostGIS database</td><td><strong>Synchronized</strong></td><td class="sub">auto-sync every ${projectSettings?.dbAutoSyncSec || 60}s</td></tr>
        </tbody>
      </table>`
    },
    {
      n: '2',
      title: 'Subgrid Processing &amp; Production Breakdown',
      caption: 'Per-parcel capture volume, verification state and publication position.',
      body: `<table class="data">
        <thead>
          <tr>
            <th>Grid / Subgrid ID</th><th>Equipment</th><th class="text-right">POI Count</th><th class="text-right">Verified Frames</th>
            <th class="text-right">Distance (km)</th><th class="text-right">QA Defects</th><th>Verification Status</th><th>PIC (Engineer)</th>
          </tr>
        </thead>
        <tbody>
          ${reportBatches.map(b => {
            const subName = (extractSubgridName(b.subgrid || b.imageFilename) || b.subgrid || '').toUpperCase().trim();
            const gridVal = b.grid || '1';
            const poiVal = getPOICount(b);
            const imgCount = getImagesProcessedCount(b);
            const defectNum = b.defects || 0;
            const isSynced = b.isSyncedWithSupabase || b.status === 'Complete';
            return `
            <tr>
              <td><strong>Grid ${esc(gridVal)} / ${esc(subName)}</strong></td>
              <td class="sub">${esc(b.captureEquipment || 'MMS')}</td>
              <td class="text-right">${poiVal.toLocaleString()}</td>
              <td class="text-right">${imgCount.toLocaleString()}</td>
              <td class="text-right">${(b.kmProcessed || 0).toFixed(2)}</td>
              <td class="text-right">${defectNum > 0 ? `${defectNum} flagged` : `<span class="st-mute">0 clean</span>`}</td>
              <td><span class="st">${isSynced ? 'Verified &amp; Published' : 'Staged in Process'}</span></td>
              <td>${esc(b.pic || '')}</td>
            </tr>`;
          }).join('') || '<tr><td colspan="8">No subgrid batches registered at the reporting date.</td></tr>'}
        </tbody>
      </table>`
    },
    {
      n: '3',
      title: 'Quality Assurance &amp; Defect Audit',
      caption: 'Frame-level QC outcomes and the QA questionnaire position per subgrid.',
      body: `<table class="data">
        <thead>
          <tr>
            <th>Subgrid Audit Unit</th><th class="text-center">Blurry Frames</th><th class="text-center">Lens Obstruction</th>
            <th class="text-center">GPS Drift</th><th>QA Questionnaire Approval</th><th class="text-center">Audit Risk</th>
          </tr>
        </thead>
        <tbody>
          ${reportBatches.map(b => {
            const sgKey = (extractSubgridName(b.subgrid || b.imageFilename) || b.subgrid || '').toUpperCase().trim();
            const qaRec = qaSubgridRecords[sgKey] || qaSubgridRecords[b.imageFilename?.toUpperCase().trim() || ''] || null;
            const flags = qaRec?.flags || { blurry: false, obstruction: false, badGps: false };
            const isConfirmedDefect = qaRec?.answer === 'yes' || (b.defects || 0) > 0;
            const flagCell = (v: boolean) => `<td class="text-center"><span class="st${v ? '' : ' st-mute'}">${v ? 'Flagged' : 'Pass'}</span></td>`;
            return `
            <tr>
              <td><strong>${esc(sgKey)}</strong></td>
              ${flagCell(flags.blurry)}
              ${flagCell(flags.obstruction)}
              ${flagCell(flags.badGps)}
              <td>${qaRec?.isLocked ? (qaRec.answer === 'yes' ? 'Defect confirmed' : 'Approved (passed)') : 'Pending review'}</td>
              <td class="text-center"><span class="st${isConfirmedDefect ? '' : ' st-mute'}">${isConfirmedDefect ? 'Audit action' : 'Low risk'}</span></td>
            </tr>`;
          }).join('') || '<tr><td colspan="6">No subgrids available for QA audit.</td></tr>'}
        </tbody>
      </table>`
    },
    {
      n: '4',
      title: 'GIS Technical Infrastructure &amp; System Configuration',
      caption: 'Reference systems, sensor configuration and processing parameters in force.',
      body: `<table class="summary">
        <thead><tr><th>Parameter</th><th>Configuration</th></tr></thead>
        <tbody>
          <tr><td>Coordinate Reference System (CRS)</td><td><strong>EPSG:4326</strong> — WGS 84 ellipsoidal</td></tr>
          <tr><td>Panorama resolution / sensor</td><td><strong>${esc(projectSettings?.cameraResolution || '8K 360° equirectangular')}</strong></td></tr>
          <tr><td>Primary image repository</td><td><strong>${esc(projectSettings?.imageStoragePath || '/MMS_PIC/')}</strong> (NAS)</td></tr>
          <tr><td>Production spatial database</td><td><strong>Supabase PostGIS</strong> cloud instance</td></tr>
          <tr><td>Deliverable image model</td><td><strong>${projectSettings?.deliverableModel === 'generative_fill' ? 'Generative clean fill (full 80% ROI)' : 'Masked vehicle (top 52% ROI)'}</strong></td></tr>
          <tr><td>GPS accuracy tolerance</td><td><strong>≤ ${projectSettings?.minGpsAccuracyM || 1.0} m</strong></td></tr>
          <tr><td>AI defect matching sensitivity</td><td><strong>${projectSettings?.aiDefectThresholdPercent || 85}%</strong> threshold</td></tr>
        </tbody>
      </table>`
    },
    {
      n: '5',
      title: 'System Operations &amp; Audit Trail',
      caption: 'Most recent platform events recorded by the operations log.',
      body: `<table class="data">
        <thead>
          <tr><th style="width:140px">Timestamp</th><th>Event</th><th>Operation &amp; Action Details</th><th>Operator / Role</th><th class="text-center">Status</th></tr>
        </thead>
        <tbody>
          ${auditLogs.slice(0, 8).map(log => `
            <tr>
              <td class="sub">${esc(log.timestamp)}</td>
              <td class="sub">${esc(log.type)}</td>
              <td><strong>${esc(log.title)}</strong> — <span class="sub">${esc(log.details)}</span></td>
              <td>${esc(log.user)}</td>
              <td class="text-center"><span class="st">${esc(String(log.status || '').toUpperCase())}</span></td>
            </tr>`).join('') || '<tr><td colspan="5">No audit trail entries recorded.</td></tr>'}
        </tbody>
      </table>`
    },
    {
      n: '6',
      title: 'Formal Verification, Governance &amp; Executive Sign-off',
      caption: 'Signature blocks for the engineering, quality and directorate chain of custody.',
      body: `<div class="signoff-grid">
        <div class="signoff-box">
          <div class="signoff-role">Prepared by — GIS Engineer</div>
          <div class="signoff-line"></div>
          <div class="signoff-meta">
            <strong>Name:</strong> ${esc(projectSettings?.engineerName || operatorUser)}<br/>
            <strong>Title:</strong> ${esc(projectSettings?.engineerTitle || 'Lead GIS Operations Engineer')}<br/>
            <strong>Date:</strong> ${reportDate}
          </div>
        </div>
        <div class="signoff-box">
          <div class="signoff-role">Verified by — QA Lead</div>
          <div class="signoff-line"></div>
          <div class="signoff-meta">
            <strong>Name:</strong> ${esc(projectSettings?.qaLeadName || 'Senior Quality Auditor')}<br/>
            <strong>Title:</strong> ${esc(projectSettings?.qaLeadTitle || 'QA/QC Verification Specialist')}<br/>
            <strong>Date:</strong> ${reportDate}
          </div>
        </div>
        <div class="signoff-box">
          <div class="signoff-role">Approved by — Project Director</div>
          <div class="signoff-line"></div>
          <div class="signoff-meta">
            <strong>Name:</strong> ${esc(projectSettings?.projectDirector || projectSettings?.contractorName || 'Project Director')}<br/>
            <strong>Title:</strong> ${esc(projectSettings?.directorTitle || 'Project Director / Manager')}<br/>
            <strong>Date:</strong> ${reportDate}
          </div>
        </div>
      </div>`
    }
  ];

  return reportShell(
    'Executive Mobile Survey Progress & Quality Control Audit Report',
    `Low Voltage (LV) Asset Mapping — executive dashboard export under contract ${contractCode}`,
    refNumber('EXEC'),
    renderToc(sections) + renderSections(sections),
    {
      operator: projectSettings?.engineerName || operatorUser,
      generatedBy: 'GeoSphere 360 · Executive Processing Dashboard',
      contractCode,
      classification: 'CONFIDENTIAL',
      autoPrint: true
    }
  );
}
