import type { RunContext } from './context.ts';
import { createDelivery, getDeliveryFor, listSnapshots, resetDelivery } from './db.ts';
import { getDestination } from './destinations/index.ts';
import type { DestinationId } from './env.ts';

export type BackfillOptions = {
  destination: DestinationId;
  /** これ以降に公開された Document だけを対象にする（ISO 8601） */
  since?: string;
  /** 送信済みの Document も送り直す */
  force?: boolean;
};

export type BackfillResult = {
  destination: DestinationId;
  created: number;
  reset: number;
  skipped: number;
  /** dry-run なら予定を数えただけで D1 は触っていない */
  dryRun: boolean;
};

/**
 * 公開済みの Document を、後から追加した Destination へまとめて流す。
 *
 * - まだ Delivery が無いものは pending を作る（created）
 * - すでに pending のものは、そのまま送られるので触らない（skipped）
 * - それ以外（送信済み・失敗・取消）は `force` を付けたときだけ pending に戻す（reset）
 *   — 削除した記事の復活や、dead になった配信のやり直しがこれにあたる
 */
export async function runBackfill(
  ctx: RunContext,
  options: BackfillOptions,
): Promise<BackfillResult> {
  const destination = getDestination(options.destination);
  if (!destination) throw new Error(`未実装の Destination: ${options.destination}`);

  const snapshots = await listSnapshots(ctx.env.DB);
  const targets = snapshots.filter(
    (snapshot) =>
      !snapshot.unpublished_at && (!options.since || snapshot.published_at >= options.since),
  );

  const now = ctx.now.toISOString();
  const result: BackfillResult = {
    destination: options.destination,
    created: 0,
    reset: 0,
    skipped: 0,
    dryRun: ctx.dryRun,
  };

  for (const snapshot of targets) {
    const existing = await getDeliveryFor(ctx.env.DB, snapshot.path, options.destination);
    if (!existing) {
      // dry-run は数えるだけ。D1 には書かない
      if (!ctx.dryRun) {
        await createDelivery(ctx.env.DB, snapshot.path, options.destination, now);
      }
      result.created += 1;
      continue;
    }
    // すでに送信待ちなら、そのまま送られるので何もしない
    if (existing.status === 'pending') {
      result.skipped += 1;
      continue;
    }
    // force が無いときは既存の記録を尊重する（送信済み・失敗・取消を触らない）
    if (!options.force) {
      result.skipped += 1;
      continue;
    }
    if (!ctx.dryRun) {
      await resetDelivery(ctx.env.DB, snapshot.path, options.destination, now);
    }
    result.reset += 1;
  }

  ctx.log('info', 'Backfill を予約しました', { ...result, targets: targets.length });
  return result;
}
