#!/usr/bin/env node
/**
 * Render the GeoSphere 360 Production Setup master guide to PDF.
 *
 * Source : docs/Production Setup/guide.html   (self-contained; inline CSS + SVG)
 * Output : docs/Production Setup/GeoSphere-360-Production-Setup-Guide.pdf
 *
 * Uses a locally installed Chrome or Edge in headless print mode, so there is no
 * npm dependency and no network access required.
 *
 *   node scripts/build-setup-pdf.mjs
 *   node scripts/build-setup-pdf.mjs --out "some other name.pdf"
 *   node scripts/build-setup-pdf.mjs --screenshot   (also emit preview PNGs)
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'docs', 'Production Setup', 'guide.html');
const OUT = join(ROOT, 'docs', 'Production Setup', 'GeoSphere-360-Production-Setup-Guide.pdf');
const SHOT_DIR = join(ROOT, 'docs', 'Production Setup', '.preview');

const argv = process.argv.slice(2);
const wantScreenshots = argv.includes('--screenshot');
const outIdx = argv.indexOf('--out');
const outPath = outIdx !== -1 && argv[outIdx + 1] ? resolve(argv[outIdx + 1]) : OUT;

/** Candidate browsers, in preference order, per platform. */
function findBrowser() {
  const candidates =
    process.platform === 'win32'
      ? [
          'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
          'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
          'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
          'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
        ]
      : process.platform === 'darwin'
        ? [
            '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
            '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
            '/Applications/Chromium.app/Contents/MacOS/Chromium',
          ]
        : ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge'];

  for (const bin of candidates) if (existsSync(bin)) return bin;
  for (const bin of ['chrome', 'google-chrome', 'chromium', 'msedge', 'edge']) {
    try {
      return execFileSync(process.platform === 'win32' ? 'where' : 'which', [bin], { encoding: 'utf8' })
        .split(/\r?\n/)[0]
        .trim();
    } catch {
      /* keep looking */
    }
  }
  return null;
}

/** Chrome writes asynchronously on some platforms; wait for the file to settle. */
function waitForFile(path, timeoutMs = 60000) {
  const started = Date.now();
  let lastSize = -1;
  while (Date.now() - started < timeoutMs) {
    if (existsSync(path)) {
      const size = statSync(path).size;
      if (size > 0 && size === lastSize) return size;
      lastSize = size;
    }
    execFileSync(process.platform === 'win32' ? 'cmd' : 'sh', [process.platform === 'win32' ? '/c' : '-c', 'sleep 0.3']);
  }
  return existsSync(path) ? statSync(path).size : 0;
}

/** Count pages from the PDF page tree without a PDF library. */
function pageCount(pdfPath) {
  const buf = readFileSync(pdfPath);
  const counts = [...buf.toString('latin1').matchAll(/\/Count\s+(\d+)/g)].map((m) => Number(m[1]));
  return counts.length ? Math.max(...counts) : 0;
}

function run(browser, args) {
  execFileSync(browser, args, { stdio: 'ignore', windowsHide: true });
}

function main() {
  if (!existsSync(SRC)) {
    console.error(`error: source not found: ${SRC}`);
    process.exit(1);
  }

  const browser = findBrowser();
  if (!browser) {
    console.error('error: no Chrome/Edge found. Install Google Chrome or Microsoft Edge.');
    process.exit(1);
  }
  console.log(`browser : ${browser}`);
  console.log(`source  : ${SRC}`);

  const fileUrl = `file:///${SRC.replace(/\\/g, '/').replace(/ /g, '%20')}`;

  // ---- PDF -------------------------------------------------------------
  run(browser, [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--no-pdf-header-footer',
    '--print-to-pdf-no-header',
    '--run-all-compositor-stages-before-draw',
    '--virtual-time-budget=10000',
    `--print-to-pdf=${outPath}`,
    fileUrl,
  ]);

  if (!existsSync(outPath) || statSync(outPath).size === 0) {
    console.error('error: PDF was not produced');
    process.exit(1);
  }
  const pages = pageCount(outPath);
  console.log(`output  : ${outPath}`);
  console.log(`size    : ${(statSync(outPath).size / 1024).toFixed(0)} KB`);
  console.log(`pages   : ${pages}`);

  // ---- Optional PNG previews (used to eyeball the layout) -------------
  if (wantScreenshots) {
    mkdirSync(SHOT_DIR, { recursive: true });
    const shots = [
      { name: 'cover', w: 1240, h: 1754 },
      { name: 'topology', w: 1240, h: 1000 },
    ];
    for (const s of shots) {
      const png = join(SHOT_DIR, `${s.name}.png`);
      run(browser, [
        '--headless=new',
        '--disable-gpu',
        '--no-sandbox',
        '--hide-scrollbars',
        `--window-size=${s.w},${s.h}`,
        `--screenshot=${png}`,
        fileUrl,
      ]);
      waitForFile(png);
      console.log(`preview : ${png}`);
    }
  }
}

main();