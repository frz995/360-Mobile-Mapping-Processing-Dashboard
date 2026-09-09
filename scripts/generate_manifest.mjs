#!/usr/bin/env node
/**
 * generate_manifest.mjs — build a public frame `manifest.json` from a NAS
 * deliverable folder, so the dashboard can count 360° frames dynamically on any
 * object-storage provider (implementation_plan_v19.md).
 *
 * Usage:
 *   node scripts/generate_manifest.mjs <folder> [--subgrid SG01] [--layout multires_tiles|single_equirectangular] [--output out.json]
 *
 * Layout auto-detection:
 *   - any `config.json` found       -> multires_tiles (each station folder = 1 frame)
 *   - image files at the folder root-> single_equirectangular (each image = 1 frame)
 */
import { readdirSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { basename, extname, join, relative, resolve, dirname } from 'node:path';
import { argv } from 'node:process';

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.tif', '.tiff']);
const CONFIG_NAME = 'config.json';

function parseArgs(args) {
  const out = { folder: '', subgrid: '', layout: '', output: '' };
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--subgrid' || a === '--layout' || a === '--output') {
      out[a.slice(2)] = args[++i] || '';
    } else if (a.startsWith('--')) {
      const key = a.slice(2);
      out[key] = args[++i] || '';
    } else {
      positional.push(a);
    }
  }
  out.folder = out.folder || positional[0] || '';
  return out;
}

function collectEntries(root) {
  const configFiles = [];
  const rootImages = [];
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.startsWith('.')) continue;
      const full = join(dir, entry);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        stack.push(full);
      } else if (entry.toLowerCase() === CONFIG_NAME) {
        configFiles.push(full);
      } else if (dir === root && IMAGE_EXTS.has(extname(entry).toLowerCase())) {
        rootImages.push(full);
      }
    }
  }
  return { configFiles, rootImages };
}

function extractSubgrid(name, fallback = '') {
  if (!name) return fallback;
  const coord = name.match(/[NS]\d+[EW]\d+/i);
  if (coord) return coord[0].toUpperCase();
  const prefix = name.match(/^([A-Za-z0-9]+)[-_]/);
  if (prefix) return prefix[1].toUpperCase();
  return fallback;
}

function toPosix(p) {
  return p.split(/[\\/]+/).filter(Boolean).join('/');
}

function buildManifest(root, opts) {
  const { configFiles, rootImages } = collectEntries(root);
  const explicitLayout = String(opts.layout || '').toLowerCase();
  const layout =
    explicitLayout ||
    (configFiles.length ? 'multires_tiles' : rootImages.length ? 'single_equirectangular' : 'multires_tiles');

  const frames = [];
  const seen = new Set();

  if (layout === 'multires_tiles') {
    for (const cfg of configFiles) {
      const dir = dirname(cfg);
      const pointFolder = basename(dir);
      const path = toPosix(relative(root, cfg));
      if (seen.has(path)) continue;
      seen.add(path);
      frames.push({
        subgrid: opts.subgrid || extractSubgrid(pointFolder),
        pointFolder,
        filename: `${pointFolder}.jpg`,
        path
      });
    }
  } else {
    for (const img of rootImages) {
      const filename = basename(img);
      const pointFolder = filename.replace(/\.[^./]+$/, '');
      const path = toPosix(relative(root, img));
      if (seen.has(path)) continue;
      seen.add(path);
      frames.push({
        subgrid: opts.subgrid || extractSubgrid(pointFolder),
        pointFolder,
        filename,
        path
      });
    }
  }

  frames.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { version: 1, layout, frames };
}

const opts = parseArgs(argv.slice(2));
if (!opts.folder) {
  console.error('Usage: node scripts/generate_manifest.mjs <folder> [--subgrid SG01] [--layout multires_tiles|single_equirectangular] [--output out.json]');
  process.exit(1);
}

const root = resolve(opts.folder);
const manifest = buildManifest(root, opts);
const output = resolve(opts.output || join(root, 'manifest.json'));

try {
  mkdirSync(dirname(output), { recursive: true });
} catch {
  /* output dir may already exist */
}
writeFileSync(output, JSON.stringify(manifest, null, 2));
console.log(`Manifest written: ${output}`);
console.log(`Layout: ${manifest.layout} (explicit layout: ${opts.layout || 'auto'})`);
console.log(`Frames: ${manifest.frames.length}`);