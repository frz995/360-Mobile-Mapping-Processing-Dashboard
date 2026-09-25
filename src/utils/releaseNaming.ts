import { extractCanonicalSubgrid } from './datasetLineage';

export const RELEASE_IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.tif', '.tiff']);

export interface ReleaseManifestFile {
  sourcePath: string;
  sourceName: string;
  releaseName: string;
  relativePath: string;
  mediaType: 'image' | 'metadata';
  sizeBytes: number;
  sha256: string;
  sortOrder: number;
}

export interface ReleaseManifest {
  schemaVersion: 1;
  projectId: string;
  runId: string;
  attemptId: string;
  subgrid: string;
  runCode: string;
  captureDate: string;
  sourceFolder: string;
  releaseFolder: string;
  generatedAt: string;
  files: ReleaseManifestFile[];
  csvFiles: string[];
  fileCount: number;
  totalSizeBytes: number;
}

export function normalizeReleaseSubgrid(value: string): string {
  const subgrid = extractCanonicalSubgrid(value);
  if (!subgrid || !/^[A-Z0-9_-]+$/.test(subgrid)) {
    throw new Error('A safe subgrid is required');
  }
  return subgrid;
}

export function normalizeReleaseDate(value: string): string {
  const date = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error('Capture date must use YYYY-MM-DD');
  }
  return date;
}

export function formatRunCode(subgrid: string, captureDate: string, sequence: number): string {
  const safeSubgrid = normalizeReleaseSubgrid(subgrid);
  const safeDate = normalizeReleaseDate(captureDate);
  if (!Number.isInteger(sequence) || sequence < 1) {
    throw new Error('Run sequence must be a positive integer');
  }
  return `${safeSubgrid}-${safeDate}-R${String(sequence).padStart(3, '0')}`;
}

export function formatReleaseCode(runCode: string): string {
  const safeRunCode = runCode.trim();
  if (!/^[A-Z0-9_-]+$/.test(safeRunCode)) {
    throw new Error('A safe run code is required');
  }
  return `${safeRunCode}-REL`;
}

export function buildReleaseFileName(subgrid: string, index: number, sourceName: string): string {
  const safeSubgrid = normalizeReleaseSubgrid(subgrid);
  if (!Number.isInteger(index) || index < 1) {
    throw new Error('Release file index must be a positive integer');
  }
  const extension = sourceName.includes('.')
    ? sourceName.slice(sourceName.lastIndexOf('.')).toLowerCase()
    : '.jpg';
  const safeExtension = /^\.[a-z0-9]{2,5}$/.test(extension) ? extension : '.jpg';
  return `${safeSubgrid}-${String(index).padStart(4, '0')}${safeExtension}`;
}

export function buildReleaseFolder(rootFolder: string, subgrid: string, runCode: string): string {
  const safeSubgrid = normalizeReleaseSubgrid(subgrid);
  const safeRunCode = runCode.trim();
  if (!/^[A-Z0-9_-]+$/.test(safeRunCode)) {
    throw new Error('A safe run code is required');
  }
  const normalizedRoot = rootFolder.replace(/[\\/]+$/, '');
  return `${normalizedRoot}/${safeSubgrid}/${safeRunCode}`;
}

export function buildReleaseManifest(input: {
  projectId: string;
  runId: string;
  attemptId: string;
  subgrid: string;
  runCode: string;
  captureDate: string;
  sourceFolder: string;
  releaseFolder: string;
  files: ReleaseManifestFile[];
  csvFiles?: string[];
  generatedAt?: string;
}): ReleaseManifest {
  const files = [...input.files].sort((a, b) => a.sortOrder - b.sortOrder);
  return {
    schemaVersion: 1,
    projectId: input.projectId,
    runId: input.runId,
    attemptId: input.attemptId,
    subgrid: normalizeReleaseSubgrid(input.subgrid),
    runCode: input.runCode,
    captureDate: normalizeReleaseDate(input.captureDate),
    sourceFolder: input.sourceFolder,
    releaseFolder: input.releaseFolder,
    generatedAt: input.generatedAt || new Date().toISOString(),
    files,
    csvFiles: [...(input.csvFiles || [])].sort(),
    fileCount: files.length,
    totalSizeBytes: files.reduce((total, file) => total + file.sizeBytes, 0)
  };
}
