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
  recoverStaleSending,
  scheduleDeletionForPath,
  selectDueDeliveries,
  setBskyRef,
} from './db.ts';
import { getDestination } from './destinations/index.ts';
import { notify } from './notify.ts';
import { snapshotToDocument, type DeliveryRow } from './types.ts';

/** 送信中のまま残った行を再試行に戻すまでの時間 */
const STALE_SENDING_MS = 10 * 60 * 1000;

export type DeliveryOutcome = 'sent' | 'deleted' | 'retrying' | 'dead' | 'skipped' | 'not-claimed';

export type DeliveryStats = {
  processed: number;
  sent: number;
  deleted: number;
  retrying: number;
  dead: number;
  skipped: number;
  recovered: number;
};

export function emptyDeliveryStats(): DeliveryStats {
  return { processed: 0, sent: 0, deleted: 0, retrying: 0, dead: 0, skipped: 0, recovered: 0 };
}

/**
 * 期日が来た Delivery を処理する。
 * 1件の失敗が他に波及しないよう、Destination ごとに閉じて扱う。
 */
export async function processDueDeliveries(ctx: RunContext, limit = 20): Promise<DeliveryStats> {
  const db = ctx.env.DB;
  const nowIso = ctx.now.toISOString();
  const stats = emptyDeliveryStats();

  // 落ちた・タイムアウトした run が残した sending を回収してから処理する
  stats.recovered = await recoverStaleSending(
    db,
    new Date(ctx.now.getTime() - STALE_SENDING_MS).toISOString(),
    nowIso,
  );
  if (stats.recovered > 0) {
    ctx.log('warn', '送信中のまま残っていた Delivery を再試行に戻しました', {
      recovered: stats.recovered,
    });
  }

  const due = await selectDueDeliveries(db, nowIso, limit);
  for (const row of due) {
    const outcome = await processDelivery(ctx, row);
    switch (outcome) {
      case 'sent':
        stats.processed += 1;
        stats.sent += 1;
        break;
      case 'deleted':
        stats.processed += 1;
        stats.deleted += 1;
        break;
      case 'retrying':
        stats.processed += 1;
        stats.retrying += 1;
        break;
      case 'dead':
        stats.processed += 1;
        stats.dead += 1;
        break;
      case 'skipped':
        stats.processed += 1;
        stats.skipped += 1;
        break;
      default:
        break;
    }
  }

  return stats;
}

/**
 * Delivery 1件を処理する。期日処理も手動再送もここを通る。
 *
 * dry-run では状態を一切変えず、送るはずの内容をログに出すだけ。
 * 権限（`sending`）は `claimDelivery` の UPDATE が取れたときだけ処理を進める。
 */
export async function processDelivery(ctx: RunContext, row: DeliveryRow): Promise<DeliveryOutcome> {
  const db = ctx.env.DB;
  const nowIso = ctx.now.toISOString();
  const destination = getDestination(row.destination);

  if (!destination) {
    await markDead(db, row.id, row.attempt, `未実装の Destination: ${row.destination}`, nowIso);
    await notify(ctx, `⚠️ 未実装の Destination が有効になっています: \`${row.destination}\`（${row.path}）`);
    return 'dead';
  }

  const configured = await destination.isConfigured(ctx);
  if (row.action === 'publish' && !configured) {
    await markDead(db, row.id, row.attempt, '資格情報が未設定', nowIso);
    await notify(ctx, `⚠️ ${destination.label} の資格情報が未設定です（${row.path}）`);
    return 'dead';
  }

  // dry-run は状態を変えない（送る内容だけ見せる）
  if (ctx.dryRun) {
    const snapshot = await getSnapshot(db, row.path);
    if (snapshot && !snapshot.unpublished_at) {
      const doc = snapshotToDocument(snapshot, SITE_URL);
      const preview =
        row.action === 'delete'
          ? { action: 'delete', external: row.external_uri }
          : ((await destination.publish(ctx, doc, snapshot)).request ?? null);
      ctx.log('info', '[dry-run] 配信の予定', {
        destination: destination.id,
        action: row.action,
        path: row.path,
        request: preview,
      });
    }
    return 'not-claimed';
  }

  if (!(await claimDelivery(db, row.id, nowIso))) return 'not-claimed';

  try {
    if (row.action === 'delete') {
      await destination.remove(ctx, row);
      await markDeleted(db, row.id, nowIso);
      ctx.log('info', '配信を取り消しました', { destination: destination.id, path: row.path });
      return 'deleted';
    }

    const snapshot = await getSnapshot(db, row.path);
    if (!snapshot || snapshot.unpublished_at) {
      await markDeleted(db, row.id, nowIso);
      return 'skipped';
    }

    const doc = snapshotToDocument(snapshot, SITE_URL);
    const outcome = await destination.publish(ctx, doc, snapshot);
    await markSent(db, row.id, outcome, nowIso);
    ctx.log('info', '配信しました', {
      destination: destination.id,
      path: row.path,
      uri: outcome.externalUri,
    });

    // Bluesky はレコード側に逆参照を書き戻す。失敗しても配信自体は成功扱い
    if (outcome.recordRef) {
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

    // 送信中に非公開へ変わっていたら、その場で削除ジョブに切り替える
    const after = await getSnapshot(db, row.path);
    if (!after || after.unpublished_at) {
      await scheduleDeletionForPath(db, row.path, nowIso);
      ctx.log('info', '送信後に非公開を検知したため削除を予約しました', { path: row.path });
    }

    return 'sent';
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const attempt = row.attempt + 1;
    const next = nextAttemptAt(attempt, ctx.now);
    if (next === null) {
      await markDead(db, row.id, attempt, message, nowIso);
      await notify(
        ctx,
        `❌ ${destination.label} への配信が再試行 ${MAX_ATTEMPTS} 回でも成功しませんでした: \`${row.path}\`\n${message}`,
      );
      return 'dead';
    }
    await markPendingRetry(db, row.id, attempt, next, message, nowIso);
    ctx.log('warn', '配信に失敗しました', {
      destination: destination.id,
      path: row.path,
      attempt,
      nextAttemptAt: next,
      error: message,
    });
    return 'retrying';
  }
}
