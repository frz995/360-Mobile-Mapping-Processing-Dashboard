/**
 * Lightweight in-browser ZIP extractor supporting Stored (0) and Deflate (8) compression.
 * Uses the Web Compression Streams API (DecompressionStream('deflate-raw')), available in all modern browsers.
 */

export interface ExtractedZipFile {
  name: string;
  data: Uint8Array;
}

export async function decompressDeflateRaw(compressedBytes: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('DecompressionStream is not supported in this browser environment.');
  }
  const ds = new DecompressionStream('deflate-raw');
  const writer = ds.writable.getWriter();
  await writer.write(compressedBytes as unknown as BufferSource);
  await writer.close();
  const response = new Response(ds.readable);
  const buffer = await response.arrayBuffer();
  return new Uint8Array(buffer);
}

/**
 * Extract files from a ZIP buffer using the Central Directory index.
 */
export async function extractZipFiles(buffer: ArrayBuffer): Promise<ExtractedZipFile[]> {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  const totalLen = buffer.byteLength;

  if (totalLen < 22) {
    throw new Error('Invalid file: File is too small to be a valid ZIP archive.');
  }

  // 1. Locate End of Central Directory (EOCD) signature 0x06054b50 (PK\x05\x06)
  let eocdOffset = -1;
  const maxSearch = Math.min(totalLen, 65557);
  for (let i = totalLen - 22; i >= totalLen - maxSearch; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }

  if (eocdOffset === -1) {
    throw new Error('Could not find End of Central Directory record. Not a valid ZIP file.');
  }

  const numEntries = view.getUint16(eocdOffset + 10, true);
  const cdOffset = view.getUint32(eocdOffset + 16, true);

  const files: ExtractedZipFile[] = [];
  let currentOffset = cdOffset;

  for (let i = 0; i < numEntries && currentOffset + 46 <= totalLen; i++) {
    const sig = view.getUint32(currentOffset, true);
    if (sig !== 0x02014b50) {
      break;
    }

    const method = view.getUint16(currentOffset + 10, true);
    const compSize = view.getUint32(currentOffset + 20, true);
    const nameLen = view.getUint16(currentOffset + 28, true);
    const extraLen = view.getUint16(currentOffset + 30, true);
    const commentLen = view.getUint16(currentOffset + 32, true);
    const localHeaderOffset = view.getUint32(currentOffset + 42, true);

    const nameBytes = bytes.subarray(currentOffset + 46, currentOffset + 46 + nameLen);
    const filename = new TextDecoder('utf-8').decode(nameBytes);

    // Skip directory entries
    if (!filename.endsWith('/') && !filename.endsWith('\\')) {
      // Read local file header to find start of compressed data
      if (localHeaderOffset + 30 <= totalLen) {
        const localSig = view.getUint32(localHeaderOffset, true);
        if (localSig === 0x04034b50) {
          const localNameLen = view.getUint16(localHeaderOffset + 26, true);
          const localExtraLen = view.getUint16(localHeaderOffset + 28, true);
          const dataStart = localHeaderOffset + 30 + localNameLen + localExtraLen;
          const compressedData = bytes.subarray(dataStart, dataStart + compSize);

          if (method === 0) {
            // Stored (no compression)
            files.push({
              name: filename,
              data: new Uint8Array(compressedData)
            });
          } else if (method === 8) {
            // Deflate compression
            const decompressed = await decompressDeflateRaw(compressedData);
            files.push({
              name: filename,
              data: decompressed
            });
          } else {
            console.warn(`[ZIP] Unsupported compression method ${method} for ${filename}`);
          }
        }
      }
    }

    currentOffset += 46 + nameLen + extraLen + commentLen;
  }

  return files;
}
