type Listener = (heading: number) => void;

let value = 0;
const listeners = new Set<Listener>();

function emit() {
  listeners.forEach((l) => l(value));
}

/** Current live heading in degrees (single source of truth, no React re-render). */
export function getHeading(): number {
  return value;
}

/** Set the live heading and notify subscribers. */
export function setHeading(heading: number) {
  const next = typeof heading === 'number' && isFinite(heading) ? heading : 0;
  if (next === value) return;
  value = next;
  emit();
}

/** Subscribe to heading changes. Returns an unsubscribe function. */
export function subscribeHeading(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
