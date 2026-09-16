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

// jsdom lacks IntersectionObserver — showcase scroll reveals degrade to their
// final state without it, but provide a no-op stub so consumers can mount.
if (typeof window !== 'undefined' && !('IntersectionObserver' in window)) {
  class IntersectionObserverStub {
    readonly root = null
    readonly rootMargin = ''
    readonly thresholds: number[] = []
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords(): IntersectionObserverEntry[] { return [] }
  }
  ;(window as any).IntersectionObserver = IntersectionObserverStub
  ;(globalThis as any).IntersectionObserver = IntersectionObserverStub
}

// jsdom lacks ResizeObserver - Lenis constructs its Dimensions watcher on the
// scroll-port element, so provide a no-op stub for it and the rest of the page.
if (typeof window !== 'undefined' && !('ResizeObserver' in window)) {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  ;(window as any).ResizeObserver = ResizeObserverStub
  ;(globalThis as any).ResizeObserver = ResizeObserverStub
}

// jsdom does not implement scroll APIs — no-op them for click-driven navigation.
if (typeof window !== 'undefined') {
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = function () {} as any
  }
  if (!('scrollTo' in Element.prototype)) {
    ;(Element.prototype as any).scrollTo = function () {}
  }
}

afterAll(() => {
  vi.restoreAllMocks()
})
