import { describe, expect, it } from 'vitest';
import { MAX_ATTEMPTS, nextAttemptAt } from './backoff.ts';
import { enabledDestinations, type Env } from './env.ts';

describe('nextAttemptAt', () => {
  const now = new Date('2026-09-18T00:00:00.000Z');

  it('失敗回数に応じて間隔が伸びる', () => {
    expect(nextAttemptAt(1, now)).toBe('2026-09-18T00:01:00.000Z');
    expect(nextAttemptAt(2, now)).toBe('2026-09-18T00:05:00.000Z');
    expect(nextAttemptAt(3, now)).toBe('2026-09-18T00:30:00.000Z');
    expect(nextAttemptAt(4, now)).toBe('2026-09-18T02:00:00.000Z');
    expect(nextAttemptAt(5, now)).toBe('2026-09-18T12:00:00.000Z');
  });

  it('上限を超えたら null（dead にする）', () => {
    expect(nextAttemptAt(MAX_ATTEMPTS + 1, now)).toBeNull();
  });
});

describe('enabledDestinations', () => {
  const env = (value?: string) => ({ ENABLED_DESTINATIONS: value }) as unknown as Env;

  it('未設定なら bluesky だけ', () => {
    expect(enabledDestinations(env())).toEqual(['bluesky']);
  });

  it('カンマ区切りを解釈し、未知の値は落とす', () => {
    expect(enabledDestinations(env('bluesky, mastodon,nope, nostr'))).toEqual([
      'bluesky',
      'mastodon',
      'nostr',
    ]);
  });

  it('すべて未知なら空になる', () => {
    expect(enabledDestinations(env('nope'))).toEqual([]);
  });
});
