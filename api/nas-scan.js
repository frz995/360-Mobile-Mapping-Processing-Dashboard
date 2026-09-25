import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_NAS_ROOT = 'D:/Webmap/360 web mapping/Project_Test';

export default async function handler(req, res) {
  try {
    const url = new URL(req.url, 'http://localhost');
    const action = url.searchParams.get('action') || 'subgrids';
    const basePath = url.searchParams.get('basePath') || DEFAULT_NAS_ROOT;
    const subgrid = (url.searchParams.get('subgrid') || 'N93E70').toUpperCase().trim();

    res.setHeader('Content-Type', 'application/json');

    // Action 1: List all subgrids in 03_Stitching and 00_Raw_data
    if (action === 'subgrids') {
      const stitchingDir = path.join(basePath, '03_Stitching', 'Project-OUT', 'Grid 1');
      const rawDir = path.join(basePath, '00_Raw_data', 'Grid 1');
      const metaDir = path.join(basePath, '01_Metadata', 'Grid 1');
      const detected = new Set();

      const scanDir = (target) => {
        if (fs.existsSync(target)) {
          try {
            fs.readdirSync(target, { withFileTypes: true })
              .filter((dirent) => dirent.isDirectory() && !dirent.name.startsWith('.'))
              .forEach((d) => detected.add(d.name.toUpperCase().trim()));
          } catch {
            // ignore
          }
        }
      };

      scanDir(stitchingDir);
      scanDir(rawDir);
      scanDir(metaDir);

      const detectedSubgrids = Array.from(detected).sort();

      const subgridList = detectedSubgrids.map((code) => {
        const inStitching = fs.existsSync(path.join(stitchingDir, code));
        return {
          code,
          existsInStitching: inStitching,
          label: code
        };
      });

      res.statusCode = 200;
      res.end(
        JSON.stringify({
          success: true,
          basePath,
          detectedSubgrids,
          subgrids: subgridList
        })
      );
      return;
    }

    // Action 2: Read exact survey folders inside 03_Stitching for selected subgrid
    if (action === 'survey-folders') {
      const subgridStitchingDir = path.join(basePath, '03_Stitching', 'Project-OUT', 'Grid 1', subgrid);
      const metadataSubgridDir = path.join(basePath, '01_Metadata', 'Grid 1', subgrid);

      if (!fs.existsSync(subgridStitchingDir)) {
        // Subgrid directory does not exist on disk yet
        res.statusCode = 200;
        res.end(
          JSON.stringify({
            success: true,
            subgrid,
            existsOnDisk: false,
            folders: []
          })
        );
        return;
      }

      const folderEntries = fs
        .readdirSync(subgridStitchingDir, { withFileTypes: true })
        .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
        .map((d) => d.name);

      const folders = folderEntries.map((folderName) => {
        const fullFolder = path.join(subgridStitchingDir, folderName);
        let count = 0;
        let samplePano = '';
        let formatType = 'Equirectangular 360°';
        let formatDesc = 'Stitched single JPG + manifest.json';

        try {
          const files = fs.readdirSync(fullFolder);
          const images = files.filter((f) => /\.(jpe?g|png)$/i.test(f));
          count = images.length;

          if (images.length > 0) {
            samplePano = `${images[0]} .. ${images[images.length - 1]}`;
          } else {
            // Check for subfolders like panoramas / panorama-tiles
            const subdirs = files.filter((f) => {
              try {
                return fs.statSync(path.join(fullFolder, f)).isDirectory();
              } catch {
                return false;
              }
            });
            if (subdirs.includes('panorama-tiles') || subdirs.includes('panoramas')) {
              formatType = 'Tiled Cubic (Deep Zoom)';
              formatDesc = 'Multi-resolution tiles + backups';
              samplePano = 'panoramas/ & panorama-tiles/';
              // Real count only: count equirectangular images inside panoramas/
              // when present. Tile output reports 0 rather than an estimate.
              const panoDir = path.join(fullFolder, 'panoramas');
              if (fs.existsSync(panoDir)) {
                try {
                  count = fs.readdirSync(panoDir).filter((f) => /\.(jpe?g|png)$/i.test(f)).length;
                } catch {
                  count = 0;
                }
              } else {
                count = 0;
              }
            }
          }
        } catch {
          count = 0;
        }

        // Check for matching CSV in 01_Metadata
        let csvName = `${folderName}.csv`;
        let gpsCount = count || 0;
        const metaFolder = path.join(metadataSubgridDir, folderName);
        if (fs.existsSync(metaFolder)) {
          try {
            const metaFiles = fs.readdirSync(metaFolder);
            const csvFound = metaFiles.find((f) => f.endsWith('.csv') && !f.startsWith('003485-')) || metaFiles.find((f) => f.endsWith('.csv'));
            if (csvFound) {
              csvName = csvFound;
              const csvContent = fs.readFileSync(path.join(metaFolder, csvFound), 'utf-8');
              const lines = csvContent.trim().split(/\r?\n/).filter(Boolean);
              if (lines.length > 1) {
                gpsCount = lines.length - 1; // excluding header
              }
            }
          } catch {
            // ignore
          }
        }

        // Parse date from folder name if format YYYYMMDD
        let rawDate = '';
        let displayDate = folderName;
        const dateMatch = folderName.match(/(\d{4})(\d{2})(\d{2})/);
        if (dateMatch) {
          rawDate = `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`;
          const dObj = new Date(`${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`);
          if (!isNaN(dObj.getTime())) {
            displayDate = dObj.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
          }
        }

        return {
          id: folderName,
          name: folderName,
          displayDate,
          rawDate,
          panoramasCount: count,
          samplePano: samplePano,
          csvName,
          gpsCount,
          formatType,
          formatDesc,
          path: `/03_Stitching/Project-OUT/Grid 1/${subgrid}/${folderName}/`
        };
      });

      res.statusCode = 200;
      res.end(
        JSON.stringify({
          success: true,
          subgrid,
          existsOnDisk: true,
          folders
        })
      );
      return;
    }

    // Action 3: Read and parse actual survey CSV from 01_Metadata
    if (action === 'read-csv') {
      const folderName = url.searchParams.get('folder') || '';
      const customCsvName = url.searchParams.get('csv') || '';
      const metadataSubgridDir = path.join(basePath, '01_Metadata', 'Grid 1', subgrid);
      const possibleDirs = [
        path.join(metadataSubgridDir, folderName),
        metadataSubgridDir,
        path.join(basePath, '01_Metadata', subgrid)
      ];

      let csvPath = '';
      for (const d of possibleDirs) {
        if (fs.existsSync(d)) {
          if (customCsvName && fs.existsSync(path.join(d, customCsvName))) {
            csvPath = path.join(d, customCsvName);
            break;
          }
          const files = fs.readdirSync(d);
          const found = files.find((f) => f.endsWith('.csv') && !f.startsWith('003485-')) || files.find((f) => f.endsWith('.csv'));
          if (found) {
            csvPath = path.join(d, found);
            break;
          }
        }
      }

      if (!csvPath || !fs.existsSync(csvPath)) {
        res.statusCode = 404;
        res.end(JSON.stringify({ success: false, error: 'CSV file not found on disk' }));
        return;
      }

      const content = fs.readFileSync(csvPath, 'utf-8');
      const lines = content.trim().split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      if (lines.length < 2) {
        res.statusCode = 200;
        res.end(JSON.stringify({ success: true, records: [] }));
        return;
      }

      const header = lines[0].toLowerCase().split(/[,\t]/).map((h) => h.trim());
      const latIdx = header.findIndex((h) => h.includes('lat'));
      const lonIdx = header.findIndex((h) => h.includes('lon') || h.includes('lng'));
      const fileIdx = header.findIndex((h) => h.includes('file') || h.includes('name') || h.includes('img'));
      const headIdx = header.findIndex((h) => h.includes('head') || h.includes('yaw') || h.includes('azimuth'));
      const timeIdx = header.findIndex((h) => h.includes('time') || h.includes('date'));

      const records = [];
      let rowTotal = 0;
      let skippedNoCoords = 0;
      for (let i = 1; i < lines.length; i++) {
        const parts = lines[i].split(/[,\t]/).map((p) => p.trim());
        if (parts.length < 2) continue;
        rowTotal += 1;
        const seqStr = String(i).padStart(4, '0');
        const lat = latIdx >= 0 ? parseFloat(parts[latIdx]) : NaN;
        const lon = lonIdx >= 0 ? parseFloat(parts[lonIdx]) : NaN;
        const heading = headIdx >= 0 ? parseFloat(parts[headIdx]) || 0 : 0;
        const timeVal = timeIdx >= 0 && parts[timeIdx] ? parts[timeIdx] : '';
        // The source filename comes only from the CSV itself. No filename is
        // invented here: rows without one stay empty and are reported as
        // unpaired instead of being silently fabricated.
        const srcName = fileIdx >= 0 && parts[fileIdx] ? parts[fileIdx] : '';

        if (!isNaN(lat) && !isNaN(lon)) {
          records.push({
            index: i,
            sourceFilename: srcName,
            targetFilename: srcName ? `${subgrid}-${seqStr}.jpg` : '',
            timestamp: timeVal,
            latitude: parseFloat(lat.toFixed(6)),
            longitude: parseFloat(lon.toFixed(6)),
            heading: parseFloat(heading.toFixed(1)),
            isMatched: false
          });
        } else {
          skippedNoCoords += 1;
        }
      }

      res.statusCode = 200;
      res.end(JSON.stringify({ success: true, csvPath: path.basename(csvPath), rowTotal, skippedNoCoords, records }));
      return;
    }

    // Action 4: List the actual image files inside a stitched survey folder.
    // Auto-pairing uses this to verify metadata rows against real files.
    if (action === 'folder-images') {
      const folderName = url.searchParams.get('folder') || '';
      if (subgrid.includes('..') || subgrid.includes('/') || subgrid.includes('\\') ||
          folderName.includes('..') || folderName.includes('/') || folderName.includes('\\')) {
        res.statusCode = 400;
        res.end(JSON.stringify({ success: false, error: 'Invalid path segment' }));
        return;
      }

      const target = path.join(basePath, '03_Stitching', 'Project-OUT', 'Grid 1', subgrid, folderName);
      if (!folderName || !fs.existsSync(target)) {
        res.statusCode = 200;
        res.end(JSON.stringify({ success: true, existsOnDisk: false, count: 0, images: [] }));
        return;
      }

      let images = [];
      try {
        images = fs
          .readdirSync(target)
          .filter((f) => /\.(jpe?g|png)$/i.test(f))
          .sort();
      } catch {
        images = [];
      }

      res.statusCode = 200;
      res.end(JSON.stringify({ success: true, existsOnDisk: true, count: images.length, images }));
      return;
    }

    res.statusCode = 400;
    res.end(JSON.stringify({ error: `Unknown action: ${action}` }));
  } catch (err) {
    res.statusCode = 500;
    res.end(JSON.stringify({ error: err.message || String(err) }));
  }
}
