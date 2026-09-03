export type ReportLevel = 'debug' | 'info' | 'warn' | 'error';

export interface ReportEntry {
  id: number;
  ts: number;
  level: ReportLevel;
  message: string;
  origin?: string;
  extra?: Record<string, unknown>;
}

export interface ReportSink {
  (entry: ReportEntry): void;
}

const DEFAULT_CAPACITY = 500;

let entries: ReportEntry[] = [];
let listeners = new Set<(snapshot: ReportEntry[]) => void>();
let sinks = new Set<ReportSink>();
let nextId = 1;

let capacity = DEFAULT_CAPACITY;

/** Attach an external sink (e.g. Sentry) to every captured entry. */
export function addReportSink(sink: ReportSink): () => void {
  sinks.add(sink);
  return () => {
    sinks.delete(sink);
  };
}

/** Subscribe to live snapshots of the in-memory buffer. */
export function subscribeReports(listener: (snapshot: ReportEntry[]) => void): () => void {
  listeners.add(listener);
  listener([...entries]);
  return () => {
    listeners.delete(listener);
  };
}

/** Manually override the ring-buffer capacity (mainly for tests). */
export function setReportCapacity(next: number): void {
  capacity = Math.max(1, next);
  if (entries.length > capacity) {
    entries = entries.slice(entries.length - capacity);
  }
  emit();
}

export function clearReports(): void {
  entries = [];
  emit();
}

/** Read-only snapshot of the current buffer. */
export function getReports(): ReportEntry[] {
  return [...entries];
}

function emit(): void {
  const snapshot = [...entries];
  listeners.forEach((listener) => listener(snapshot));
}

function push(level: ReportLevel, message: string, origin?: string, extra?: Record<string, unknown>): ReportEntry {
  const entry: ReportEntry = { id: nextId++, ts: Date.now(), level, message, origin, extra };
  entries.push(entry);
  if (entries.length > capacity) {
    entries = entries.slice(entries.length - capacity);
  }
  emit();
  const snap: ReportEntry = { ...entry };
  sinks.forEach((sink) => {
    try {
      sink(snap);
    } catch (err) {
      // A misbehaving sink must never break the rest of the app.
      /* istanbul ignore next */
      if (typeof console !== 'undefined') console.warn('report sink error:', err);
    }
  });
  return snap;
}

export function reportDebug(message: string, origin?: string, extra?: Record<string, unknown>): ReportEntry {
  return push('debug', message, origin, extra);
}

export function reportInfo(message: string, origin?: string, extra?: Record<string, unknown>): ReportEntry {
  return push('info', message, origin, extra);
}

export function reportWarn(message: string, origin?: string, extra?: Record<string, unknown>): ReportEntry {
  return push('warn', message, origin, extra);
}

export function reportError(message: string, origin?: string, extra?: Record<string, unknown>): ReportEntry {
  return push('error', message, origin, extra);
}

function normalizeError(err: unknown): string {
  if (err instanceof Error) return err.message || String(err);
  if (typeof err === 'string') return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

function installGlobalHandlers(): () => void {
  const onError = (event: ErrorEvent) => {
    push('error', event.message || 'Uncaught error', 'window.onerror', {
      filename: event.filename,
      line: event.lineno,
      col: event.colno
    });
  };
  const onRejection = (event: PromiseRejectionEvent) => {
    push('error', `Unhandled rejection: ${normalizeError(event.reason)}`, 'unhandledrejection');
  };

  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);

  return () => {
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onRejection);
  };
}

let installed = false;

/**
 * Install global window handlers once. Safe to call multiple times.
 */
export function installReporters(): () => void {
  if (installed) {
    return () => {};
  }
  installed = true;
  return installGlobalHandlers();
}
