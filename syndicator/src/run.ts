import { deleteRecordAtUri, ensurePublication, putDocumentRecord } from './atproto.ts';
import type { RunContext } from './context.ts';
import {
  createDelivery,
  getDocumentRecord,
  insertRunLog,
  insertSnapshot,
  listSnapshots,
  listSnapshotsNeedingRecord,
  markRecordDeleted,
  markRepublished,
  markUnpublished,
  scheduleDeletionForPath,
  setRecordHash,
  updateSnapshotContent,
  upsertDocumentRecord,
} from './db.ts';
import { processDueDeliveries, type DeliveryStats } from './delivery.ts';
import { planSync } from './diff.ts';
import { enabledDestinations, isPlaceholderAtUri } from './env.ts';
import { fetchFeed } from './feed.ts';
import { refreshThreadsTokenIfNeeded, type RefreshOutcome } from './threads.ts';
import { notify } from './notify.ts';

export type RunSummary = {
  trigger: string;
  dryRun: boolean;
  feedItems: number;
  insert: number;
  update: number;
  republish: number;
  unpublish: number;
  skippedUnpublish: number;
  records: number;
  publicationSynced: boolean;
  threadsToken: RefreshOutcome;
  deliveries: DeliveryStats;
  durationMs: number;
};

function emptyDeliveryStats(): DeliveryStats {
  return { processed: 0, sent: 0, deleted: 0, retrying: 0, dead: 0, skipped: 0 };
}

/**
 * 同期の本体。
 *
 * 1. 公開フィードを取得して Snapshot と突き合わせる
 * 2. 新規 Document には Delivery を用意する
 * 3. 消えた Document はレコード削除 + 削除伝播を予約する
 * 4. 未反映の Document を ATProto レコードへ書く
 * 5. 期日が来た Delivery を処理する
 *
 * 1つの Destination の失敗が他へ波及しないよう、各段は独立している。
 */
export async function runSyndication(ctx: RunContext): Promise<RunSummary> {
  const startedAt = Date.now();
  const db = ctx.env.DB;
  const nowIso = ctx.now.toISOString();
  const destinations = enabledDestinations(ctx.env);

  const summary: RunSummary = {
    trigger: ctx.trigger,
    dryRun: ctx.dryRun,
    feedItems: 0,
    insert: 0,
    update: 0,
    republish: 0,
    unpublish: 0,
    skippedUnpublish: 0,
    records: 0,
    publicationSynced: false,
    threadsToken: 'skipped',
    deliveries: emptyDeliveryStats(),
    durationMs: 0,
  };

  // 1. フィードとの差分
  const feed = await fetchFeed(ctx);
  summary.feedItems = feed.items.length;
  const snapshots = await listSnapshots(db);
  const plan = planSync(feed, snapshots);

  for (const entry of plan.insert) {
    await insertSnapshot(db, entry, nowIso);
    for (const destination of destinations) {
      await createDelivery(db, entry.path, destination, nowIso);
    }
    summary.insert += 1;
  }

  for (const entry of plan.update) {
    await updateSnapshotContent(db, entry);
    summary.update += 1;
  }

  for (const entry of plan.republish) {
    await markRepublished(db, entry.path);
    summary.republish += 1;
  }

  summary.skippedUnpublish = plan.skippedUnpublish;
  for (const row of plan.unpublish) {
    await markUnpublished(db, row.path, nowIso);
    await scheduleDeletionForPath(db, row.path, nowIso);
    if (!ctx.dryRun) await deleteDocumentRecord(ctx, row.path);
    summary.unpublish += 1;
  }

  // 2. ATProto レコードの反映（dry-run では何も書かない）
  if (!ctx.dryRun) {
    if (isPlaceholderAtUri(ctx.publicationAtUri)) {
      throw new Error(
        'publication の AT-URI がプレースホルダのままです。`npm run bootstrap -w syndicator` を実行して config.json を更新してください',
      );
    }
    const pending = await listSnapshotsNeedingRecord(db);
    if (pending.length > 0) {
      const publication = await ensurePublication(ctx);
      summary.publicationSynced = !publication.existed;
      for (const snapshot of pending) {
        const record = await putDocumentRecord(ctx, snapshot);
        await upsertDocumentRecord(
          db,
          { path: snapshot.path, rkey: record.rkey, atUri: record.atUri, cid: record.cid },
          nowIso,
        );
        await setRecordHash(db, snapshot.path, snapshot.content_hash);
        summary.records += 1;
        ctx.log('info', 'レコードを書き込みました', { path: snapshot.path, atUri: record.atUri });
      }
    }
  }

  // 3. 期限切れが近い資格情報の更新（Threads は 60 日で切れるため run ごとに見る）
  if (destinations.includes('threads')) {
    summary.threadsToken = await refreshThreadsTokenIfNeeded(ctx);
  }

  // 4. 配信
  summary.deliveries = await processDueDeliveries(ctx, 20);

  summary.durationMs = Date.now() - startedAt;
  return summary;
}

async function deleteDocumentRecord(ctx: RunContext, path: string): Promise<void> {
  const db = ctx.env.DB;
  const record = await getDocumentRecord(db, path);
  if (!record || record.state === 'deleted') return;
  try {
    await deleteRecordAtUri(ctx, record.at_uri);
    await markRecordDeleted(db, path, ctx.now.toISOString());
  } catch (error) {
    ctx.log('warn', 'レコードの削除に失敗しました', { path, error: String(error) });
  }
}

/** run を実行し、結果を run_log と Discord に残す */
export async function runAndRecord(ctx: RunContext): Promise<RunSummary> {
  const startedAt = new Date().toISOString();
  try {
    const summary = await runSyndication(ctx);
    await insertRunLog(ctx.env.DB, {
      startedAt,
      trigger: ctx.trigger,
      summary: JSON.stringify(summary),
    });

    const changed =
      summary.insert + summary.update + summary.unpublish + summary.records > 0 ||
      summary.deliveries.processed > 0 ||
      summary.deliveries.dead > 0;

    if (summary.deliveries.dead > 0) {
      await notify(ctx, `⚠️ 配信に失敗したまま停止した Delivery が ${summary.deliveries.dead} 件あります`);
    } else if (changed && !ctx.dryRun) {
      await notify(
        ctx,
        `📮 新規 ${summary.insert} / 更新 ${summary.update} / 削除 ${summary.unpublish}` +
          ` / 配信 ${summary.deliveries.sent}（再試行待ち ${summary.deliveries.retrying}）`,
      );
    }
    return summary;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await insertRunLog(ctx.env.DB, {
      startedAt,
      trigger: ctx.trigger,
      summary: '{}',
      error: message,
    });
    await notify(ctx, `❌ Syndicator が失敗しました: ${message}`);
    throw error;
  }
}
