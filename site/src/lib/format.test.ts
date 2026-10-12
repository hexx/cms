import { describe, expect, it } from 'vitest';
import { formatListDate } from './format';

describe('formatListDate', () => {
  it('月.日(曜) を JST で出す', () => {
    expect(formatListDate(new Date('2026-01-01T00:00:00+09:00'))).toBe('1.1(木)');
    expect(formatListDate(new Date('2026-10-12T04:00:00+09:00'))).toBe('10.12(月)');
  });

  it('UTC では前日でも JST の日付になる', () => {
    expect(formatListDate(new Date('2025-12-31T16:00:00Z'))).toBe('1.1(木)');
  });
});
