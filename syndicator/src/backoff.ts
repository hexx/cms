/**
 * 失敗した Delivery の再試行間隔（1分 → 5分 → 30分 → 2時間 → 12時間）。
 * 配列の長さが最大試行回数になる。
 */
export const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 3_600_000, 12 * 3_600_000] as const;

export const MAX_ATTEMPTS = RETRY_DELAYS_MS.length;

/**
 * 次回試行時刻を返す。attempt は「今回の失敗を含む」試行回数（1始まり）。
 * 上限を超えたら null（＝dead にして Discord へ通知する）。
 */
export function nextAttemptAt(attempt: number, now: Date): string | null {
  const delay = RETRY_DELAYS_MS[attempt - 1];
  if (delay === undefined) return null;
  return new Date(now.getTime() + delay).toISOString();
}
