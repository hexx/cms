import { SITE_URL } from '@hexx/shared';
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
  pruneRunLog,
  scheduleDeletionForPath,
  setRecordHash,
  tryAcquireRunLock,
  updateSnapshotContent,
  upsertDocumentRecord,
} from './db.ts';
import { emptyDeliveryStats, processDueDeliveries, type DeliveryStats } from './delivery.ts';
import { getDestination } from './destinations/index.ts';
import { planSync, type FeedEntry } from './diff.ts';
import { enabledDestinations, isPlaceholderAtUri } from './env.ts';
import { fetchFeed } from './feed.ts';
import { notify } from './notify.ts';
import { refreshThreadsTokenIfNeeded, type RefreshOutcome } from './threads.ts';
import { snapshotToDocument, type SnapshotRow } from './types.ts';

/** 実行ロックの保持時間。これを過ぎたロックは奪える（Worker が落ちても固まらない） */
const RUN_LOCK_LEASE_MS = 2 * 60 * 1000;

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
 * dry-run のときは **D1 を一切書き換えない**（何が起きるはずかだけを報告する）。
 */
export async function runSyndication(ctx: RunContext): Promise<RunSummary> {
  const startedAt = Date.now();
  const db = ctx.env.DB;
  const destinations = enabledDestinations(ctx.env);

  if (ctx.dryRun) return previewRun(ctx, destinations, startedAt);

  const nowIso = ctx.now.toISOString();
  const summary: RunSummary = {
    trigger: ctx.trigger,
    dryRun: false,
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
    await unpublishDocument(ctx, row.path);
    summary.unpublish += 1;
  }

  // 2. ATProto レコードの反映
  const pending = await listSnapshotsNeedingRecord(db);
  if (pending.length > 0) {
    if (isPlaceholderAtUri(ctx.publicationAtUri)) {
      throw new Error(
        'publication の AT-URI がプレースホルダのままです。`npm run bootstrap` を実行して config.json を更新してください',
      );
    }
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

  // 3. 期限切れが近い資格情報の更新（Threads は 60 日で切れる）
  if (destinations.includes('threads')) {
    summary.threadsToken = await refreshThreadsTokenIfNeeded(ctx);
  }

  // 4. 配信
  summary.deliveries = await processDueDeliveries(ctx, 20);

  summary.durationMs = Date.now() - startedAt;
  return summary;
}

/**
 * dry-run。フィードを読んで「何が起きるはずか」を報告するだけで、D1 も外部も触らない。
 * 本番前に全 Destination の文面を確認するために使う（docs/spec.md §12）。
 */
async function previewRun(
  ctx: RunContext,
  destinations: ReturnType<typeof enabledDestinations>,
  startedAt: number,
): Promise<RunSummary> {
  const db = ctx.env.DB;
  const feed = await fetchFeed(ctx);
  const snapshots = await listSnapshots(db);
  const plan = planSync(feed, snapshots);

  for (const entry of plan.insert) {
    ctx.log('info', '[dry-run] 新規 Document（配信予定）', {
      path: entry.path,
      destinations,
    });
    const pseudo = entryToSnapshot(entry, ctx.now.toISOString());
    await previewDeliveries(ctx, pseudo);
  }
  for (const entry of plan.update) ctx.log('info', '[dry-run] 内容が変化（再投稿しない）', { path: entry.path });
  for (const entry of plan.republish) ctx.log('info', '[dry-run] 再公開（レコードを作り直す）', { path: entry.path });
  for (const row of plan.unpublish) ctx.log('info', '[dry-run] 非公開（レコードと投稿を削除）', { path: row.path });

  const needingRecord = await listSnapshotsNeedingRecord(db);
  for (const snapshot of needingRecord) {
    ctx.log('info', '[dry-run] レコードを書き込む予定', { path: snapshot.path });
  }

  // 期日が来ている Delivery も、送る内容だけ見せる
  const deliveries = await processDueDeliveries(ctx, 20);

  return {
    trigger: ctx.trigger,
    dryRun: true,
    feedItems: feed.items.length,
    insert: plan.insert.length,
    update: plan.update.length,
    republish: plan.republish.length,
    unpublish: 0,
    skippedUnpublish: plan.skippedUnpublish,
    // 新規に書く予定 + 内容が変わって書き直す予定
    records: plan.insert.length + needingRecord.length,
    publicationSynced: false,
    threadsToken: 'skipped',
    deliveries,
    durationMs: Date.now() - startedAt,
  };
}

/** dry-run で「送るはずの内容」を Destination ごとに組み立ててログに出す */
async function previewDeliveries(ctx: RunContext, snapshot: SnapshotRow): Promise<void> {
  const doc = snapshotToDocument(snapshot, SITE_URL);

  for (const id of enabledDestinations(ctx.env)) {
    const destination = getDestination(id);
    if (!destination) {
      ctx.log('warn', '[dry-run] 未実装の Destination が有効です', { destination: id });
      continue;
    }
    try {
      const outcome = await destination.publish(ctx, doc, snapshot);
      ctx.log('info', `[dry-run] ${destination.label} に送る内容`, {
        path: doc.path,
        request: outcome.request ?? null,
      });
    } catch (error) {
      ctx.log('warn', `[dry-run] ${destination.label} の内容を組み立てられません`, {
        path: doc.path,
        error: String(error),
      });
    }
  }
}

/** フィードの1件を、DB に入れる前の SnapshotRow の形に整える（preview 専用） */
function entryToSnapshot(entry: FeedEntry, now: string): SnapshotRow {
  return {
    path: entry.path,
    kind: entry.kind,
    slug: entry.slug,
    title: entry.title,
    description: entry.description ?? null,
    tags: JSON.stringify(entry.tags),
    cover_image_url: entry.coverImageUrl ?? null,
    text_content: entry.textContent ?? null,
    published_at: entry.publishedAt,
    updated_at: entry.updatedAt ?? null,
    content_hash: entry.contentHash,
    record_hash: null,
    first_seen_at: now,
    unpublished_at: null,
  };
}

/**
 * 1つの Document を非公開にする（レコード削除 + 削除伝播の予約）。
 * フィードが空のときは安全装置で見送るので、意図的な削除の出口として
 * `POST /v1/unpublish` からも呼ぶ。
 */
export async function unpublishDocument(ctx: RunContext, path: string): Promise<void> {
  const nowIso = ctx.now.toISOString();
  await markUnpublished(ctx.env.DB, path, nowIso);
  await scheduleDeletionForPath(ctx.env.DB, path, nowIso);
  if (!ctx.dryRun) await deleteDocumentRecord(ctx, path);
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

/**
 * run を実行し、結果を run_log と Discord に残す。
 *
 * 実行ロックを取れなかったときは何もせず `{ skipped: 'locked' }` を返す
 * （Cron とデプロイフックが重なっても同じ Document を二重に処理しない）。
 */
export async function runAndRecord(
  ctx: RunContext,
): Promise<RunSummary | { skipped: 'locked' }> {
  const startedAt = new Date().toISOString();
  const staleBefore = new Date(ctx.now.getTime() - RUN_LOCK_LEASE_MS).toISOString();

  if (!(await tryAcquireRunLock(ctx.env.DB, startedAt, staleBefore, ctx.trigger))) {
    ctx.log('info', '別の run が実行中のため見送りました', { trigger: ctx.trigger });
    return { skipped: 'locked' };
  }

  try {
    const summary = await runSyndication(ctx);
    // dry-run は状態を変えないので履歴にも残さない
    if (!ctx.dryRun) {
      await insertRunLog(ctx.env.DB, {
        startedAt,
        trigger: ctx.trigger,
        summary: JSON.stringify(summary),
      });
      // 実行履歴は 30 日分だけ残す（10分ごとに走るので放っておくと増え続ける）
      await pruneRunLog(ctx.env.DB, new Date(ctx.now.getTime() - 30 * 24 * 3_600_000).toISOString());
    }

    const changed =
      summary.insert + summary.update + summary.unpublish + summary.records > 0 ||
      summary.deliveries.processed > 0 ||
      summary.deliveries.dead > 0;

    if (summary.deliveries.dead > 0) {
      await notify(ctx, `⚠️ 配信に失敗したまま停止した Delivery が ${summary.deliveries.dead} 件あります`);
    } else if (summary.skippedUnpublish > 0) {
      await notify(
        ctx,
        `⚠️ フィードが空のため ${summary.skippedUnpublish} 件の削除を見送りました（安全装置）。` +
          '意図的な削除なら `POST /v1/unpublish {"all":true}` で消せます',
      );
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
