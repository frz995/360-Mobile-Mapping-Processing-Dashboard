import '@testing-library/jest-dom/vitest'
import { afterAll, vi } from 'vitest'

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
