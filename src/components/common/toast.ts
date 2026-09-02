export type ToastKind = 'success' | 'error' | 'info';

export interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
}

type ToastListener = (toasts: ToastItem[]) => void;

let toasts: ToastItem[] = [];
const listeners = new Set<ToastListener>();
let nextId = 1;

const DEFAULT_DURATION_MS = 4200;

function emit(): void {
  const snapshot = [...toasts];
  listeners.forEach((listener) => listener(snapshot));
}

function dismiss(id: number): void {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

function push(kind: ToastKind, message: string, durationMs: number = DEFAULT_DURATION_MS): number {
  const id = nextId++;
  toasts = [...toasts, { id, kind, message }];
  emit();
  if (durationMs > 0) {
    window.setTimeout(() => dismiss(id), durationMs);
  }
  return id;
}

export const toast = {
  success: (message: string): number => push('success', message),
  error: (message: string): number => push('error', message),
  info: (message: string): number => push('info', message)
};

export function subscribeToasts(listener: ToastListener): () => void {
  listeners.add(listener);
  listener([...toasts]);
  return () => {
    listeners.delete(listener);
  };
}

export function dismissToast(id: number): void {
  dismiss(id);
}