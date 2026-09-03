import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setDataQuiet, isDataQuiet, quietWarn, quietLog } from '../quiet';

describe('data-quiet mode', () => {
  beforeEach(() => {
    setDataQuiet(false);
  });

  it('toggles the quiet flag via the setter', () => {
    expect(isDataQuiet()).toBe(false);
    setDataQuiet(true);
    expect(isDataQuiet()).toBe(true);
    setDataQuiet(false);
    expect(isDataQuiet()).toBe(false);
  });

  it('quietWarn/quietLog emit when quiet is off', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      quietWarn('scope', 'message');
      quietLog('scope', 'message');
      expect(spy).toHaveBeenCalledTimes(1);
      expect(logSpy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
      logSpy.mockRestore();
    }
  });

  it('suppresses output when quiet is on', () => {
    setDataQuiet(true);
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      quietWarn('scope', 'message');
      quietLog('scope', 'message');
      expect(spy).not.toHaveBeenCalled();
      expect(logSpy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
      logSpy.mockRestore();
    }
  });
});
