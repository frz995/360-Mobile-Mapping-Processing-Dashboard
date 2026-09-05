import { describe, it, expect } from 'vitest';
import { formatPIC } from '../picFormat';

describe('formatPIC', () => {
  it('capitalizes the first letter of a trimmed name', () => {
    expect(formatPIC('fariz.farhan95')).toBe('Fariz.farhan95');
  });

  it('returns the fallback for empty/whitespace input', () => {
    expect(formatPIC('')).toBe('Fariz.farhan95');
    expect(formatPIC('   ', 'Default')).toBe('Default');
    expect(formatPIC(null, 'X')).toBe('X');
    expect(formatPIC(undefined)).toBe('Fariz.farhan95');
  });

  it('returns the fallback for placeholder names', () => {
    expect(formatPIC('Unassigned')).toBe('Fariz.farhan95');
    expect(formatPIC('OPERATOR')).toBe('Fariz.farhan95');
  });

  it('keeps names unchanged when non-empty and not a placeholder', () => {
    expect(formatPIC('Admin')).toBe('Admin');
    expect(formatPIC('ali')).toBe('Ali');
  });
});