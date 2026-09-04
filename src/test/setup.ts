import '@testing-library/jest-dom/vitest'
import { afterAll, vi } from 'vitest'
// @ts-ignore
import fs from 'node:fs'

// Mock /data/malaysia.district.geojson in test environment
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const urlStr = typeof input === 'string' ? input : input.toString();
  if (urlStr.includes('malaysia.district.geojson')) {
    // @ts-ignore
    const cwd = typeof process !== 'undefined' && process.cwd ? process.cwd() : '.';
    const filePath = `${cwd}/public/data/malaysia.district.geojson`;
    // @ts-ignore
    const content = fs.readFileSync(filePath, 'utf-8');
    return new Response(content, {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  return originalFetch ? originalFetch(input, init) : new Response('Not found', { status: 404 });
};

// jsdom lacks matchMedia; a handful of components call it. Provide a stub.
if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false
    }) as any
}

afterAll(() => {
  vi.restoreAllMocks()
})
