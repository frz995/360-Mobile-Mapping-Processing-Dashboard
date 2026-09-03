import * as Sentry from '@sentry/react';
import type { ReportEntry } from './report';

const DSN = (import.meta.env.VITE_SENTRY_DSN as string | undefined) || '';

let enabled = false;

export function isSentryEnabled(): boolean {
  return enabled;
}

/**
 * Initialise Sentry only when a DSN is configured. When absent this is a
 * complete no-op so local/dev builds and CI never send telemetry or fail.
 */
export function initSentry(): void {
  if (!DSN) {
    enabled = false;
    return;
  }
  Sentry.init({
    dsn: DSN,
    environment: import.meta.env.MODE || 'development',
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
    tracesSampleRate: 0.1,
    ignoreErrors: [
      // Non-actionable third-party / benign messages
      'ResizeObserver loop',
      'Non-Error promise rejection captured'
    ],
    beforeSend(event) {
      // Never leak request bodies/headers into events.
      delete event.request;
      return event;
    }
  });
  enabled = true;
}

export function captureException(error: unknown, context?: Record<string, unknown>): string | undefined {
  if (!enabled || !error) return undefined;
  try {
    return Sentry.captureException(error instanceof Error ? error : new Error(String(error)), {
      contexts: context ? { runtime: context } : undefined
    });
  } catch {
    return undefined;
  }
}

export function captureMessage(message: string, level: 'info' | 'warning' | 'error' = 'info'): string | undefined {
  if (!enabled) return undefined;
  try {
    return Sentry.captureMessage(message, level);
  } catch {
    return undefined;
  }
}

/** Adapts a captured report entry into a Sentry event. Used as a report sink. */
export function sentryReportSink(entry: ReportEntry): void {
  if (!enabled) return;
  const extra = { ...(entry.extra || {}) } as Record<string, unknown>;
  if (entry.origin) extra.origin = entry.origin;
  try {
    if (entry.level === 'error') {
      Sentry.captureException(new Error(entry.message), { extra });
    } else {
      Sentry.captureMessage(entry.message, entry.level === 'warn' ? 'warning' : 'info');
    }
  } catch {
    // Never let Sentry break the app.
  }
}
