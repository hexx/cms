import type { HexxJsonFeed, JsonFeedItem } from '@hexx/shared';
import type { SnapshotRow } from './types.ts';

/** フィード由来の Document。DB に入れる前の形 */
export type FeedEntry = {
  path: string;
  kind: 'post' | 'note';
  slug: string;
  title: string;
  description?: string;
  tags: string[];
  coverImageUrl?: string;
  textContent?: string;
  publishedAt: string;
  updatedAt?: string;
  contentHash: string;
};

export type SyncPlan = {
  /** 新規公開。Delivery を作る */
  insert: FeedEntry[];
  /** 内容が変わった。Snapshot を更新する（SNS へは再投稿しない） */
  update: FeedEntry[];
  /** 非公開だったものが戻ってきた。レコードは作り直すが SNS へは再投稿しない */
  republish: FeedEntry[];
  /** フィードから消えた。削除伝播の対象 */
  unpublish: SnapshotRow[];
  /** 安全装置が働いて見送った unpublish の件数 */
  skippedUnpublish: number;
};

export function toFeedEntry(item: JsonFeedItem): FeedEntry {
  const meta = item._hexx;
  const text = item.content_text;
  return {
    path: meta.path,
    kind: meta.kind,
    slug: meta.slug,
    title: meta.title,
    ...(meta.description ? { description: meta.description } : {}),
    tags: meta.tags,
    ...(meta.coverImage ? { coverImageUrl: meta.coverImage } : {}),
    ...(text ? { textContent: text } : {}),
    publishedAt: meta.publishedAt,
    ...(meta.updatedAt ? { updatedAt: meta.updatedAt } : {}),
    contentHash: meta.contentHash,
  };
}

/**
 * 公開フィードと手元の Snapshot を突き合わせて、何をするかを決める。
 *
 * 安全装置: フィードが空なのに手元に公開中の Snapshot があるときは unpublish しない。
 * （壊れたデプロイやフィードの取り違えで全記事を削除してしまうのを防ぐ）
 */
export function planSync(feed: HexxJsonFeed, snapshots: SnapshotRow[]): SyncPlan {
  const byPath = new Map<string, SnapshotRow>(snapshots.map((row) => [row.path, row]));

  const plan: SyncPlan = {
    insert: [],
    update: [],
    republish: [],
    unpublish: [],
    skippedUnpublish: 0,
  };

  const seen = new Set<string>();
  for (const item of feed.items) {
    const entry = toFeedEntry(item);
    seen.add(entry.path);
    const existing = byPath.get(entry.path);

    if (!existing) {
      plan.insert.push(entry);
      continue;
    }
    if (existing.unpublished_at) {
      plan.republish.push(entry);
      continue;
    }
    if (existing.content_hash !== entry.contentHash) {
      plan.update.push(entry);
    }
  }

  const vanished = snapshots.filter((row) => !row.unpublished_at && !seen.has(row.path));
  if (feed.items.length === 0 && vanished.length > 0) {
    plan.skippedUnpublish = vanished.length;
  } else {
    plan.unpublish = vanished;
  }

  return plan;
}
