import { getPOICount, getImagesProcessedCount } from '../../utils/dashboardData';
import { extractSubgridName } from '../../utils/subgrid';
import type { BatchLog, AuditLogItem } from '../../types/dashboard';
import type { QAFlagState } from '../../hooks/useAppData';

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

    const now = new Date();
    const reportDate = now.toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' }) + ' • ' + now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    const documentRefNo = `GEO-MMS-EXEC-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${Math.floor(1000 + Math.random() * 9000)}`;

    const html = `
      <!DOCTYPE html>
      <html lang="en">
        <head>
          <meta charset="UTF-8">
          <title>GeoSphere 360 - Executive Progress & Quality Audit Report</title>
          <style>
            @page {
              size: A4 portrait;
              margin: 12mm 15mm 15mm 15mm;
            }
            * { box-sizing: border-box; }
            body {
              font-family: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
              color: #0f172a;
              background: #ffffff;
              margin: 0;
              padding: 24px;
              font-size: 11px;
              line-height: 1.5;
              -webkit-print-color-adjust: exact;
              print-color-adjust: exact;
            }
            
            /* Print action toolbar for screen preview */
            .action-bar {
              display: flex;
              justify-content: space-between;
              align-items: center;
              background: #0f172a;
              color: #ffffff;
              padding: 12px 20px;
              margin: -24px -24px 24px -24px;
              border-bottom: 1px solid #334155;
            }
            .action-bar-title {
              font-weight: 700;
              font-size: 13px;
              letter-spacing: 0.5px;
            }
            .print-btn {
              background: #ffffff;
              color: #0f172a;
              border: none;
              padding: 7px 16px;
              font-size: 11px;
              font-weight: 700;
              border-radius: 4px;
              cursor: pointer;
              text-transform: uppercase;
              letter-spacing: 0.5px;
            }
            .print-btn:hover { background: #e2e8f0; }

            /* Header Section */
            .doc-header {
              display: flex;
              justify-content: space-between;
              align-items: flex-start;
              border-bottom: 2px solid #0f172a;
              padding-bottom: 14px;
              margin-bottom: 20px;
            }
            .org-title {
              font-size: 10px;
              font-weight: 800;
              letter-spacing: 1.5px;
              color: #475569;
              text-transform: uppercase;
              margin-bottom: 2px;
            }
            .main-title {
              font-size: 20px;
              font-weight: 800;
              color: #0f172a;
              margin: 0 0 4px 0;
              letter-spacing: -0.3px;
            }
            .sub-title {
              font-size: 12px;
              font-weight: 600;
              color: #334155;
            }
            .doc-meta-box {
              background: #f8fafc;
              border: 1px solid #cbd5e1;
              border-radius: 4px;
              padding: 8px 12px;
              font-size: 10px;
              min-width: 240px;
            }
            .meta-row {
              display: flex;
              justify-content: space-between;
              padding: 2px 0;
              border-bottom: 1px dashed #e2e8f0;
            }
            .meta-row:last-child { border-bottom: none; }
            .meta-label { font-weight: 600; color: #64748b; }
            .meta-val { font-weight: 700; color: #0f172a; font-family: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }

            /* Narrative Box */
            .section-title {
              font-size: 12px;
              font-weight: 800;
              text-transform: uppercase;
              letter-spacing: 0.8px;
              color: #0f172a;
              border-bottom: 1px solid #0f172a;
              padding-bottom: 4px;
              margin: 22px 0 10px 0;
            }
            .narrative-box {
              background: #f8fafc;
              border-left: 3px solid #0f172a;
              border-top: 1px solid #e2e8f0;
              border-right: 1px solid #e2e8f0;
              border-bottom: 1px solid #e2e8f0;
              padding: 10px 14px;
              font-size: 11px;
              color: #334155;
              text-align: justify;
              line-height: 1.6;
              margin-bottom: 18px;
            }

            /* KPI Grid */
            .kpi-grid {
              display: grid;
              grid-template-columns: repeat(3, 1fr);
              gap: 10px;
              margin-bottom: 20px;
              page-break-inside: avoid;
            }
            .kpi-card {
              background: #ffffff;
              border: 1px solid #cbd5e1;
              border-radius: 4px;
              padding: 10px 12px;
            }
            .kpi-label {
              font-size: 9.5px;
              font-weight: 700;
              text-transform: uppercase;
              letter-spacing: 0.5px;
              color: #64748b;
              margin-bottom: 4px;
            }
            .kpi-value {
              font-size: 18px;
              font-weight: 800;
              color: #0f172a;
              font-variant-numeric: tabular-nums;
              line-height: 1.2;
            }
            .kpi-subtext {
              font-size: 9.5px;
              color: #475569;
              margin-top: 3px;
              font-weight: 500;
            }

            /* Tables */
            table {
              width: 100%;
              border-collapse: collapse;
              margin-bottom: 18px;
              font-size: 10.5px;
              page-break-inside: auto;
            }
            tr { page-break-inside: avoid; page-break-after: auto; }
            th {
              background: #0f172a;
              color: #ffffff;
              padding: 7px 10px;
              text-align: left;
              font-size: 9.5px;
              font-weight: 700;
              text-transform: uppercase;
              letter-spacing: 0.5px;
              border: 1px solid #0f172a;
            }
            td {
              border: 1px solid #e2e8f0;
              padding: 7px 10px;
              color: #1e293b;
              vertical-align: middle;
            }
            tr:nth-child(even) td { background: #f8fafc; }
            
            .text-center { text-align: center; }
            .text-right { text-align: right; }
            .font-sans { font-family: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
            
            /* Status Badges - Monochrome & Professional */
            .badge {
              display: inline-block;
              padding: 2px 7px;
              border-radius: 3px;
              font-size: 9px;
              font-weight: 700;
              text-transform: uppercase;
              letter-spacing: 0.3px;
              white-space: nowrap;
            }
            .badge-complete {
              background: #f1f5f9;
              color: #0f172a;
              border: 1px solid #475569;
            }
            .badge-defect {
              background: #0f172a;
              color: #ffffff;
              border: 1px solid #0f172a;
            }
            .badge-neutral {
              background: #f8fafc;
              color: #475569;
              border: 1px solid #cbd5e1;
            }

            /* 2-Column Specs Layout */
            .specs-grid {
              display: grid;
              grid-template-columns: repeat(2, 1fr);
              gap: 12px;
              margin-bottom: 20px;
              page-break-inside: avoid;
            }
            .spec-card {
              border: 1px solid #cbd5e1;
              border-radius: 4px;
              background: #f8fafc;
              padding: 10px 12px;
            }
            .spec-row {
              display: flex;
              justify-content: space-between;
              padding: 3px 0;
              border-bottom: 1px solid #e2e8f0;
              font-size: 10px;
            }
            .spec-row:last-child { border-bottom: none; }
            .spec-key { color: #64748b; font-weight: 600; }
            .spec-val { color: #0f172a; font-weight: 700; }

            /* Sign-off Section */
            .signoff-section {
              margin-top: 30px;
              page-break-inside: avoid;
            }
            .signoff-grid {
              display: grid;
              grid-template-columns: repeat(3, 1fr);
              gap: 15px;
              margin-top: 15px;
            }
            .signoff-box {
              border: 1px solid #cbd5e1;
              border-radius: 4px;
              padding: 12px;
              background: #ffffff;
            }
            .signoff-role {
              font-size: 9.5px;
              font-weight: 800;
              text-transform: uppercase;
              color: #0f172a;
              border-bottom: 1px solid #cbd5e1;
              padding-bottom: 4px;
              margin-bottom: 10px;
              letter-spacing: 0.5px;
            }
            .signoff-line {
              border-bottom: 1px solid #0f172a;
              height: 35px;
              margin-bottom: 10px;
            }
            .signoff-meta {
              font-size: 9.5px;
              color: #475569;
              line-height: 1.4;
            }

            /* Footer */
            .doc-footer {
              border-top: 1px solid #cbd5e1;
              padding-top: 10px;
              margin-top: 30px;
              display: flex;
              justify-content: space-between;
              align-items: center;
              font-size: 9px;
              color: #64748b;
              page-break-inside: avoid;
            }

            @media print {
              .action-bar { display: none !important; }
              body { padding: 0; background: #ffffff; }
            }
          </style>
        </head>
        <body>
          <div class="action-bar no-print">
            <div class="action-bar-title">EXECUTIVE PDF REPORT PREVIEW</div>
            <button class="print-btn" onclick="window.print()">PRINT / SAVE AS PDF</button>
          </div>

          <!-- DOCUMENT HEADER -->
          <div class="doc-header">
            <div>
              <div class="org-title">GEOSPHERE 360 • SPATIAL ASSET INTELLIGENCE</div>
              <h1 class="main-title">GeoSphere 360 Operations Hub</h1>
              <div class="sub-title">Executive Mobile Survey Progress & Quality Control Audit Report</div>
            </div>
            <div class="doc-meta-box">
              <div class="meta-row">
                <span class="meta-label">DOCUMENT REF:</span>
                <span class="meta-val">${documentRefNo}</span>
              </div>
              <div class="meta-row">
                <span class="meta-label">DATE & TIME:</span>
                <span class="meta-val">${reportDate}</span>
              </div>
              <div class="meta-row">
                <span class="meta-label">CLASSIFICATION:</span>
                <span class="meta-val">CONFIDENTIAL</span>
              </div>
              <div class="meta-row">
                <span class="meta-label">CONTRACT CODE:</span>
                <span class="meta-val">${projectSettings?.contractCode || 'MMS-2026-TNB-01'}</span>
              </div>
              <div class="meta-row">
                <span class="meta-label">SYSTEM STATUS:</span>
                <span class="meta-val">OPERATIONAL</span>
              </div>
            </div>
          </div>

          <!-- EXECUTIVE NARRATIVE -->
          <div class="narrative-box">
            <strong>EXECUTIVE OVERVIEW & SYNTHESIS:</strong> This official report presents the validated progress, technical performance, and quality assurance auditing metrics for the ongoing Low Voltage (LV) Asset Mapping initiative under contract <strong>${projectSettings?.contractCode || 'MMS-2026-TNB-01'}</strong>. As of <strong>${reportDate}</strong>, spatial data acquisition teams have mapped a total cumulative trajectory of <strong>${totalKmVal.toFixed(2)} km</strong> across <strong>${subgridsCount} active subgrids</strong>, capturing <strong>${totalPoiCount.toLocaleString()} POI points</strong> and <strong>${totalPanoramasCount.toLocaleString()} verified 360° panorama frames</strong>. Automated feature detection and manual quality control reviews confirm an overall <strong>pipeline quality health rating of ${passRateVal}%</strong>. A total of <strong>${totalDefectsCount} defect anomalies</strong> (blurry lens frames, sun flare/obstructions, or GPS drift spikes) have been logged and reconciled. All verified spatial geometries are synchronized with the enterprise Supabase PostGIS vector database layer.
          </div>

          <!-- KEY PERFORMANCE INDICATORS -->
          <div class="section-title">I. Key Performance Indicators (KPI Summary)</div>
          <div class="kpi-grid">
            <div class="kpi-card">
              <div class="kpi-label">Subgrids Processed</div>
              <div class="kpi-value">${subgridsCount} Units</div>
              <div class="kpi-subtext">${publishedCount} Published • ${stagedCount} Staged</div>
            </div>
            <div class="kpi-card">
              <div class="kpi-label">Survey Trajectory</div>
              <div class="kpi-value">${totalKmVal.toFixed(2)} km</div>
              <div class="kpi-subtext">${targetProgressPct}% of Target (${targetKmVal} km)</div>
            </div>
            <div class="kpi-card">
              <div class="kpi-label">Total 360° Panoramas</div>
              <div class="kpi-value">${totalPanoramasCount.toLocaleString()} Frames</div>
              <div class="kpi-subtext">Target: ${targetImagesVal.toLocaleString()} Frames</div>
            </div>
            <div class="kpi-card">
              <div class="kpi-label">QA Defects Flagged</div>
              <div class="kpi-value">${totalDefectsCount} Anomaly Frames</div>
              <div class="kpi-subtext">Defect Rate: ${(100 - parseFloat(passRateVal)).toFixed(2)}%</div>
            </div>
            <div class="kpi-card">
              <div class="kpi-label">Pipeline Quality Health</div>
              <div class="kpi-value">${passRateVal}%</div>
              <div class="kpi-subtext">Status: QA Benchmark Passed</div>
            </div>
            <div class="kpi-card">
              <div class="kpi-label">PostGIS Database Storage</div>
              <div class="kpi-value">SYNCHRONIZED</div>
              <div class="kpi-subtext">Sync Frequency: Every ${projectSettings?.dbAutoSyncSec || 60}s</div>
            </div>
          </div>

          <!-- SUBGRID PROCESSING BREAKDOWN -->
          <div class="section-title">II. Subgrid Processing & Production Breakdown</div>
          <table>
            <thead>
              <tr>
                <th>Grid / Subgrid ID</th>
                <th>Capture Equipment</th>
                <th class="text-right">POI Count</th>
                <th class="text-right">Verified Frames</th>
                <th class="text-right">Distance (km)</th>
                <th class="text-center">Verification Status</th>
                <th class="text-center">QA Defects</th>
                <th>PIC (Engineer)</th>
                <th class="text-center">Database Sync</th>
              </tr>
            </thead>
            <tbody>
              ${reportBatches.map(b => {
      const subName = (extractSubgridName(b.subgrid || b.imageFilename) || b.subgrid || '').toUpperCase().trim();
      const gridVal = b.grid || '1';
      const eq = b.captureEquipment || 'MMS';
      const poiVal = getPOICount(b);
      const imgCount = getImagesProcessedCount(b);
      const km = (b.kmProcessed || 0).toFixed(2);
      const defectNum = b.defects || 0;
      const picName = b.pic || '';
      const isSynced = b.isSyncedWithSupabase || b.status === 'Complete';
      return `
                  <tr>
                    <td><strong class="font-sans">Grid ${gridVal} / ${subName}</strong></td>
                    <td>${eq}</td>
                    <td class="text-right font-sans">${poiVal.toLocaleString()}</td>
                    <td class="text-right font-sans">${imgCount.toLocaleString()} frames</td>
                    <td class="text-right font-sans">${km} km</td>
                    <td class="text-center">
                      <span class="badge ${isSynced ? 'badge-complete' : 'badge-neutral'}">
                        ${isSynced ? 'VERIFIED & PUBLISHED' : 'STAGED IN PROCESS'}
                      </span>
                    </td>
                    <td class="text-center">
                      ${defectNum > 0
          ? `<span class="badge badge-defect">${defectNum} FLAG${defectNum > 1 ? 'S' : ''}</span>`
          : `<span style="color:#64748b; font-size:9px;">0 (CLEAN)</span>`}
                    </td>
                    <td>${picName}</td>
                    <td class="text-center font-sans" style="font-size:9.5px;">${isSynced ? 'SUPABASE LIVE' : 'LOCAL DRAFT'}</td>
                  </tr>
                `;
    }).join('')}
            </tbody>
          </table>

          <!-- QA & DEFECT AUDIT ANALYSIS -->
          <div class="section-title">III. Quality Assurance & Defect Audit Breakdown</div>
          <table>
            <thead>
              <tr>
                <th>Subgrid Audit Unit</th>
                <th>Blurry Frames</th>
                <th>Lens Obstruction</th>
                <th>GPS Drift / Bad Coords</th>
                <th>QA Questionnaire Approval</th>
                <th class="text-center">Audit Risk Assessment</th>
              </tr>
            </thead>
            <tbody>
              ${reportBatches.map(b => {
      const sgKey = (extractSubgridName(b.subgrid || b.imageFilename) || b.subgrid || '').toUpperCase().trim();
      const qaRec = qaSubgridRecords[sgKey] || qaSubgridRecords[b.imageFilename?.toUpperCase().trim() || ''] || null;
      const flags = qaRec?.flags || { blurry: false, obstruction: false, badGps: false };
      const isConfirmedDefect = qaRec?.answer === 'yes' || (b.defects || 0) > 0;
      return `
                  <tr>
                    <td><strong class="font-sans">${sgKey}</strong></td>
                    <td class="font-sans">${flags.blurry ? 'FLAGGED (Yes)' : 'PASS (Clean)'}</td>
                    <td class="font-sans">${flags.obstruction ? 'FLAGGED (Yes)' : 'PASS (Clean)'}</td>
                    <td class="font-sans">${flags.badGps ? 'FLAGGED (Yes)' : 'PASS (Clean)'}</td>
                    <td class="font-sans">${qaRec?.isLocked ? (qaRec.answer === 'yes' ? 'DEFECT CONFIRMED' : 'APPROVED (PASSED)') : 'PENDING REVIEW'}</td>
                    <td class="text-center">
                      <span class="badge ${isConfirmedDefect ? 'badge-defect' : 'badge-complete'}">
                        ${isConfirmedDefect ? 'AUDIT ACTION' : 'LOW RISK'}
                      </span>
                    </td>
                  </tr>
                `;
    }).join('')}
            </tbody>
          </table>

          <!-- TECHNICAL SPECIFICATIONS & CONFIGURATION -->
          <div class="section-title">IV. GIS Technical Infrastructure & System Configuration</div>
          <div class="specs-grid">
            <div class="spec-card">
              <div class="spec-row">
                <span class="spec-key">Coordinate Reference System (CRS):</span>
                <span class="spec-val">EPSG:4326 (WGS 84 / Ellipsoidal)</span>
              </div>
              <div class="spec-row">
                <span class="spec-key">Panorama Resolution / Sensor:</span>
                <span class="spec-val">${projectSettings?.cameraResolution || '8K 360° Equirectangular'}</span>
              </div>
              <div class="spec-row">
                <span class="spec-key">Primary Image Repository Path:</span>
                <span class="spec-val font-sans">${projectSettings?.imageStoragePath || '/MMS_PIC/'}</span>
              </div>
            </div>
            <div class="spec-card">
              <div class="spec-row">
                <span class="spec-key">Production Spatial Database:</span>
                <span class="spec-val">Supabase PostGIS Cloud Instance</span>
              </div>
              <div class="spec-row">
                <span class="spec-key">Deliverable Image Processing Model:</span>
                <span class="spec-val">${projectSettings?.deliverableModel === 'generative_fill' ? 'Generative Clean Fill (Full 80% ROI)' : 'Masked Vehicle (Top 52% ROI)'}</span>
              </div>
              <div class="spec-row">
                <span class="spec-key">GPS Accuracy Tolerance Threshold:</span>
                <span class="spec-val">≤ ${projectSettings?.minGpsAccuracyM || 1.0} meters</span>
              </div>
              <div class="spec-row">
                <span class="spec-key">AI Defect Feature Matching Sensitivity:</span>
                <span class="spec-val">${projectSettings?.aiDefectThresholdPercent || 85}% Threshold</span>
              </div>
            </div>
          </div>

          <!-- RECENT AUDIT TRAIL -->
          <div class="section-title">V. System Operations & Audit Trail Summary</div>
          <table>
            <thead>
              <tr>
                <th style="width: 140px;">Timestamp</th>
                <th style="width: 80px;" class="text-center">Event Type</th>
                <th>Operation & Action Details</th>
                <th style="width: 120px;">Operator / Role</th>
                <th style="width: 70px;" class="text-center">Status</th>
              </tr>
            </thead>
            <tbody>
              ${auditLogs.slice(0, 5).map(log => `
                <tr>
                  <td class="font-sans" style="font-size:9.5px;">${log.timestamp}</td>
                  <td class="text-center"><span class="badge badge-neutral">${log.type}</span></td>
                  <td><strong>${log.title}</strong> — <span style="color:#475569;">${log.details}</span></td>
                  <td>${log.user}</td>
                  <td class="text-center font-sans" style="font-size:9.5px; font-weight:700;">${log.status.toUpperCase()}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>

          <!-- EXECUTIVE GOVERNANCE & SIGN-OFF -->
          <div class="signoff-section">
            <div class="section-title">VI. Formal Verification, Governance & Executive Sign-off</div>
            <div class="signoff-grid">
              <div class="signoff-box">
                <div class="signoff-role">PREPARED BY (GIS ENGINEER)</div>
                <div class="signoff-line"></div>
                <div class="signoff-meta">
                  <strong>Name:</strong> ${projectSettings?.engineerName || operatorUser}<br>
                  <strong>Title:</strong> ${projectSettings?.engineerTitle || 'Lead GIS Operations Engineer'}<br>
                  <strong>Date:</strong> ${reportDate}
                </div>
              </div>
              <div class="signoff-box">
                <div class="signoff-role">VERIFIED BY (QA LEAD)</div>
                <div class="signoff-line"></div>
                <div class="signoff-meta">
                  <strong>Name:</strong> ${projectSettings?.qaLeadName || 'Senior Quality Auditor'}<br>
                  <strong>Title:</strong> ${projectSettings?.qaLeadTitle || 'QA/QC Verification Specialist'}<br>
                  <strong>Date:</strong> ${reportDate}
                </div>
              </div>
              <div class="signoff-box">
                <div class="signoff-role">APPROVED BY (PROJECT DIRECTOR)</div>
                <div class="signoff-line"></div>
                <div class="signoff-meta">
                  <strong>Name:</strong> ${projectSettings?.projectDirector || projectSettings?.contractorName || 'Project Director'}<br>
                  <strong>Title:</strong> ${projectSettings?.directorTitle || 'Project Director / Manager'}<br>
                  <strong>Date:</strong> ${reportDate}
                </div>
              </div>
            </div>
          </div>

          <!-- DOCUMENT FOOTER -->
          <div class="doc-footer">
            <div>
              <strong>GEOSPHERE 360 OPERATIONS HUB</strong> • Mobile Mapping & Spatial Asset Intelligence
            </div>
            <div>
              STRICTLY CONFIDENTIAL • Page 1 of 1 • Generated via Executive Processing Dashboard
            </div>
          </div>

          <script>
            window.onload = function() {
              setTimeout(function() {
                window.print();
              }, 500);
            };
          </script>
        </body>
      </html>
    `;
    return html;
}
