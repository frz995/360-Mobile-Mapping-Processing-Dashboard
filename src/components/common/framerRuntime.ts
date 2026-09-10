// Minimal local stand-in for the Framer runtime APIs used by vendored
// Framer publishing modules. In a plain Vite + React app there is no
// "framer" package, so these no-op shims let components load and run
// with ordinary browser behavior (never "static/editor" rendering).

export const ControlType = {
  Boolean: "boolean",
  Number: "number",
  String: "string",
  Color: "color",
  Object: "object",
  Array: "array",
  Enum: "enum",
  Image: "image",
  File: "file",
  SegmentedEnum: "segmentedEnum",
};

export function addPropertyControls(_Component: unknown, _controls: unknown): void {
  // No-op — Framer Studio only. Property controls are irrelevant at runtime.
}

export function useIsStaticRenderer(): boolean {
  // The browser is never a "static renderer" (that's Framer's SSR/export).
  return false;
}

export const RenderTarget = {
  canvas: "canvas",
  nodes: "nodes",
  preview: "preview",
  current: () => "nodes",
} as const;