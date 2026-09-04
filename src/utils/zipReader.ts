import { unzipSync } from 'fflate';

export interface ExtractedZipFile {
  name: string;
  data: Uint8Array;
}

/**
 * Robust in-browser ZIP extractor powered by fflate.
 * Extracts all files in milliseconds without stream deadlocks or browser API constraints.
 */
export async function extractZipFiles(buffer: ArrayBuffer): Promise<ExtractedZipFile[]> {
  const bytes = new Uint8Array(buffer);
  const unzipped = unzipSync(bytes);
  const files: ExtractedZipFile[] = [];

  for (const [rawName, data] of Object.entries(unzipped)) {
    // Normalize path separators to forward slash
    const name = rawName.replace(/\\/g, '/');
    // Skip directories and macOS metadata entries
    if (name.endsWith('/') || name.includes('__MACOSX/')) {
      continue;
    }
    // Isolate buffer slice so it is a dedicated, unshared memory block
    const cleanData = new Uint8Array(data.length);
    cleanData.set(data);
    files.push({ name, data: cleanData });
  }

  return files;
}
