import { SITE_URL } from '@hexx/shared';
import { attachBskyPostRef } from './atproto.ts';
import { MAX_ATTEMPTS, nextAttemptAt } from './backoff.ts';
import type { RunContext } from './context.ts';
import {
  claimDelivery,
  getSnapshot,
  markDead,
  markDeleted,
  markPendingRetry,
  markSent,
  selectDueDeliveries,
  setBskyRef,
} from './db.ts';
import { getDestination } from './destinations/index.ts';
import { notify } from './notify.ts';
import { snapshotToDocument, type DeliveryRow } from './types.ts';

export type DeliveryStats = {
  processed: number;
  sent: number;
  deleted: number;
  retrying: number;
  dead: number;
  skipped: number;
};

/**
 * 期日が来た Delivery を処理する。
 * 1件の失敗が他に波及しないよう、Destination ごとに try/catch で閉じる。
 */
export async function processDueDeliveries(ctx: RunContext, limit = 20): Promise<DeliveryStats> {
  const db = ctx.env.DB;
  const nowIso = ctx.now.toISOString();
  const stats: DeliveryStats = { processed: 0, sent: 0, deleted: 0, retrying: 0, dead: 0, skipped: 0 };

  const due = await selectDueDeliveries(db, nowIso, limit);

  for (const row of due) {
    const destination = getDestination(row.destination);
    if (!destination) {
      await markDead(db, row.id, row.attempt, `未実装の Destination: ${row.destination}`, nowIso);
      stats.dead += 1;
      await notify(ctx, `⚠️ 未実装の Destination が有効になっています: \`${row.destination}\`（${row.path}）`);
      continue;
    }

    // dry-run は送信しないので資格情報が無くても計画を確認できるようにする
    if (row.action === 'publish' && !ctx.dryRun && !destination.isConfigured(ctx.env)) {
      await markDead(db, row.id, row.attempt, '資格情報が未設定', nowIso);
      stats.dead += 1;
      await notify(ctx, `⚠️ ${destination.label} の資格情報が未設定です（${row.path}）`);
      continue;
    }

    // 他の run が先に確保していたら何もしない
    if (!(await claimDelivery(db, row.id, nowIso))) continue;
    stats.processed += 1;

    try {
      if (row.action === 'delete') {
        await destination.remove(ctx, row);
        await markDeleted(db, row.id, nowIso);
        stats.deleted += 1;
        ctx.log('info', '配信を取り消しました', { destination: destination.id, path: row.path });
        continue;
      }

      const snapshot = await getSnapshot(db, row.path);
      if (!snapshot || snapshot.unpublished_at) {
        await markDeleted(db, row.id, nowIso);
        stats.skipped += 1;
        continue;
      }

      const doc = snapshotToDocument(snapshot, SITE_URL);
      const outcome = await destination.publish(ctx, doc, snapshot);
      await markSent(db, row.id, outcome, nowIso);
      stats.sent += 1;
      ctx.log('info', '配信しました', {
        destination: destination.id,
        path: row.path,
        uri: outcome.externalUri,
        ...(ctx.dryRun && outcome.request ? { request: outcome.request } : {}),
      });

      // Bluesky はレコード側に逆参照を書き戻す。失敗しても配信自体は成功扱い
      if (outcome.recordRef && !ctx.dryRun) {
        try {
          await attachBskyPostRef(ctx, snapshot, outcome.recordRef);
          await setBskyRef(db, snapshot.path, outcome.recordRef.uri, outcome.recordRef.cid, nowIso);
        } catch (error) {
          ctx.log('warn', 'bskyPostRef の書き戻しに失敗しました', {
            path: snapshot.path,
            error: String(error),
          });
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const attempt = row.attempt + 1;
      const next = nextAttemptAt(attempt, ctx.now);
      if (next === null) {
        await markDead(db, row.id, attempt, message, nowIso);
        stats.dead += 1;
        await notify(
          ctx,
          `❌ ${destination.label} への配信が ${MAX_ATTEMPTS} 回失敗しました: \`${row.path}\`\n${message}`,
        );
      } else {
        await markPendingRetry(db, row.id, attempt, next, message, nowIso);
        stats.retrying += 1;
      }
      ctx.log('warn', '配信に失敗しました', {
        destination: destination.id,
        path: row.path,
        attempt,
        error: message,
      });
    }
  }

  return stats;
}

/** 手動再送のために 1 件だけ処理する（管理画面・API 用） */
export async function processOneDelivery(ctx: RunContext, row: DeliveryRow): Promise<void> {
  const db = ctx.env.DB;
  const nowIso = ctx.now.toISOString();
  const destination = getDestination(row.destination);
  if (!destination) throw new Error(`未実装の Destination: ${row.destination}`);
  if (!(await claimDelivery(db, row.id, nowIso))) return;
  const snapshot = await getSnapshot(db, row.path);
  if (!snapshot) {
    await markDeleted(db, row.id, nowIso);
    return;
  }
  if (row.action === 'delete') {
    await destination.remove(ctx, row);
    await markDeleted(db, row.id, nowIso);
    return;
  }
  const doc = snapshotToDocument(snapshot, SITE_URL);
  const outcome = await destination.publish(ctx, doc, snapshot);
  await markSent(db, row.id, outcome, nowIso);
}
