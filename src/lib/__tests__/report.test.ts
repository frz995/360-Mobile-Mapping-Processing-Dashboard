import { describe, it, expect, beforeEach } from 'vitest';
import {
  getReports,
  clearReports,
  setReportCapacity,
  subscribeReports,
  addReportSink,
  reportDebug,
  reportInfo,
  reportWarn,
  reportError
} from '../report';

describe('report ring buffer', () => {
  beforeEach(() => {
    clearReports();
    setReportCapacity(500);
  });

  it('captures entries in order with level + message', () => {
    reportError('boom', 'test.origin', { code: 42 });
    reportWarn('careful');
    reportInfo('all good');
    reportDebug('trace', 'dbg');

    const entries = getReports();
    expect(entries).toHaveLength(4);
    expect(entries[0]).toMatchObject({ level: 'error', message: 'boom', origin: 'test.origin', extra: { code: 42 } });
    expect(entries[1].level).toBe('warn');
    expect(entries[2].level).toBe('info');
    expect(entries[3].level).toBe('debug');
  });

  it('caps the buffer at the configured capacity (ring behaviour)', () => {
    setReportCapacity(3);
    reportInfo('1');
    reportInfo('2');
    reportError('3');
    reportWarn('4');
    const entries = getReports();
    expect(entries).toHaveLength(3);
    expect(entries[0].message).toBe('2');
    expect(entries[entries.length - 1].message).toBe('4');
  });

  it('notifies live subscribers and unsubscribes cleanly', () => {
    const seen: string[] = [];
    const unsubscribe = subscribeReports((snap) => seen.push(snap.map((e) => e.message).join(',')));
    reportInfo('a');
    reportInfo('b');
    unsubscribe();
    reportInfo('c');
    expect(seen).toEqual(['', 'a', 'a,b']);
  });

  it('forwards entries to sinks and tolerates a throwing sink', () => {
    const received: string[] = [];
    const badSink = () => {
      throw new Error('sink broke');
    };
    const goodSink = (entry: { message: string }) => received.push(entry.message);
    const removeGood = addReportSink(goodSink);
    const removeBad = addReportSink(badSink as never);
    expect(() => reportError('should still work')).not.toThrow();
    expect(received).toEqual(['should still work']);
    removeGood();
    removeBad();
  });
});
