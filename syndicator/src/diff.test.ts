import { describe, expect, it } from 'vitest';
import type { HexxJsonFeed } from '@hexx/shared';
import { planSync, toFeedEntry } from './diff.ts';
import type { SnapshotRow } from './types.ts';

function feedItem(path: string, hash: string, title = 'タイトル') {
  return {
    id: `https://hexx.jp${path}`,
    url: `https://hexx.jp${path}`,
    title,
    summary: '説明',
    content_text: '本文',
    date_published: '2026-09-18T00:00:00.000Z',
    tags: ['meta'],
    _hexx: {
      kind: 'post' as const,
      slug: path.split('/').pop() ?? 'slug',
      path,
      title,
      description: '説明',
      tags: ['meta'],
      publishedAt: '2026-09-18T00:00:00.000Z',
      contentHash: hash,
    },
  };
}

function feed(paths: Array<[string, string]>): HexxJsonFeed {
  return {
    version: 'https://jsonfeed.org/version/1.1',
    title: 'hexx.jp',
    home_page_url: 'https://hexx.jp',
    feed_url: 'https://hexx.jp/feed-all.json',
    language: 'ja',
    items: paths.map(([path, hash]) => feedItem(path, hash)),
  };
}

function snapshot(path: string, hash: string, unpublishedAt: string | null = null): SnapshotRow {
  return {
    path,
    kind: 'post',
    slug: path.split('/').pop() ?? 'slug',
    title: 'タイトル',
    description: '説明',
    tags: JSON.stringify(['meta']),
    cover_image_url: null,
    text_content: '本文',
    published_at: '2026-09-18T00:00:00.000Z',
    updated_at: null,
    content_hash: hash,
    record_hash: hash,
    first_seen_at: '2026-09-18T00:00:00.000Z',
    unpublished_at: unpublishedAt,
  };
}

describe('toFeedEntry', () => {
  it('フィード項目を DB に入れる形に変換する', () => {
    expect(toFeedEntry(feedItem('/posts/2026/09/a', 'sha256:1'))).toMatchObject({
      path: '/posts/2026/09/a',
      kind: 'post',
      slug: 'a',
      title: 'タイトル',
      tags: ['meta'],
      textContent: '本文',
      contentHash: 'sha256:1',
    });
  });
});

describe('planSync', () => {
  it('未知の path は insert', () => {
    const plan = planSync(feed([['/posts/2026/09/a', 'sha256:1']]), []);
    expect(plan.insert.map((entry) => entry.path)).toEqual(['/posts/2026/09/a']);
    expect(plan.update).toEqual([]);
    expect(plan.unpublish).toEqual([]);
  });

  it('ハッシュが変わったら update', () => {
    const plan = planSync(
      feed([['/posts/2026/09/a', 'sha256:2']]),
      [snapshot('/posts/2026/09/a', 'sha256:1')],
    );
    expect(plan.insert).toEqual([]);
    expect(plan.update.map((entry) => entry.path)).toEqual(['/posts/2026/09/a']);
  });

  it('同じハッシュなら何もしない', () => {
    const plan = planSync(
      feed([['/posts/2026/09/a', 'sha256:1']]),
      [snapshot('/posts/2026/09/a', 'sha256:1')],
    );
    expect(plan.insert).toEqual([]);
    expect(plan.update).toEqual([]);
    expect(plan.unpublish).toEqual([]);
  });

  it('非公開だったものが戻ってきたら republish（再配信はしない）', () => {
    const plan = planSync(
      feed([['/posts/2026/09/a', 'sha256:1']]),
      [snapshot('/posts/2026/09/a', 'sha256:1', '2026-09-19T00:00:00.000Z')],
    );
    expect(plan.republish.map((entry) => entry.path)).toEqual(['/posts/2026/09/a']);
    expect(plan.insert).toEqual([]);
  });

  it('フィードから消えたら unpublish', () => {
    const plan = planSync(feed([['/posts/2026/09/b', 'sha256:1']]), [
      snapshot('/posts/2026/09/a', 'sha256:1'),
      snapshot('/posts/2026/09/b', 'sha256:1'),
    ]);
    expect(plan.unpublish.map((row) => row.path)).toEqual(['/posts/2026/09/a']);
  });

  it('フィードが空なら unpublish を見送る（安全装置）', () => {
    const plan = planSync(feed([]), [
      snapshot('/posts/2026/09/a', 'sha256:1'),
      snapshot('/posts/2026/09/b', 'sha256:1'),
    ]);
    expect(plan.unpublish).toEqual([]);
    expect(plan.skippedUnpublish).toBe(2);
  });

  it('すでに非公開のものは再度 unpublish しない', () => {
    const plan = planSync(feed([]), [snapshot('/posts/2026/09/a', 'sha256:1', '2026-09-19T00:00:00.000Z')]);
    expect(plan.unpublish).toEqual([]);
    expect(plan.skippedUnpublish).toBe(0);
  });
});
