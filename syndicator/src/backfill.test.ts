import { describe, expect, it } from 'vitest';
import { runBackfill } from './backfill.ts';
import type { RunContext } from './context.ts';
import { claimDelivery, createDelivery, getDeliveryFor, insertSnapshot, markSent } from './db.ts';
import type { Env } from './env.ts';
import { createTestDb } from './testing/d1.ts';
import type { FeedEntry } from './diff.ts';

function snapshot(path: string, publishedAt: string): FeedEntry {
  return {
    path,
    kind: 'post',
    slug: path.split('/').pop() ?? 'slug',
    title: `タイトル ${path}`,
    tags: ['meta'],
    publishedAt,
    contentHash: `sha256:${path}`,
  };
}

function context(db: D1Database, dryRun = false): RunContext {
  return {
    env: { DB: db } as Env,
    dryRun,
    now: new Date('2026-09-18T03:00:00.000Z'),
    trigger: 'test',
    publicationAtUri: 'at://did:plc:testdid/site.standard.publication/self',
    log: () => {},
  };
}

/** Delivery を確保してから送信済みにする（実際の流れと同じ順序） */
async function markSentSending(
  db: D1Database,
  path: string,
  destination: string,
  ctx: RunContext,
): Promise<void> {
  const row = (await getDeliveryFor(db, path, destination))!;
  expect(await claimDelivery(db, row.id, ctx.now.toISOString())).toBe(true);
  expect(
    await markSent(db, row.id, { externalUri: 'https://example.test/1' }, ctx.now.toISOString()),
  ).toBe(true);
}

async function seed(db: D1Database): Promise<void> {
  const now = '2026-09-18T00:00:00.000Z';
  await insertSnapshot(db, snapshot('/posts/2026/08/old', '2026-08-01T00:00:00.000Z'), now);
  await insertSnapshot(db, snapshot('/posts/2026/09/new', '2026-09-10T00:00:00.000Z'), now);
  await insertSnapshot(db, snapshot('/posts/2026/09/hidden', '2026-09-11T00:00:00.000Z'), now);
  await db.prepare('UPDATE document_snapshot SET unpublished_at = ? WHERE path = ?')
    .bind(now, '/posts/2026/09/hidden')
    .run();
}

describe('runBackfill', () => {
  it('公開中で Delivery が無い Document に pending を作る', async () => {
    const db = createTestDb();
    await seed(db);

    const result = await runBackfill(context(db), { destination: 'mastodon' });

    expect(result).toEqual({ destination: 'mastodon', created: 3 - 1, reset: 0, skipped: 0, dryRun: false });
    const created = await getDeliveryFor(db, '/posts/2026/09/new', 'mastodon');
    expect(created?.status).toBe('pending');
    expect(created?.action).toBe('publish');
  });

  it('非公開の Document は対象にしない', async () => {
    const db = createTestDb();
    await seed(db);
    await runBackfill(context(db), { destination: 'mastodon' });
    expect(await getDeliveryFor(db, '/posts/2026/09/hidden', 'mastodon')).toBeNull();
  });

  it('since で期間を絞れる', async () => {
    const db = createTestDb();
    await seed(db);

    const result = await runBackfill(context(db), {
      destination: 'nostr',
      since: '2026-09-01T00:00:00.000Z',
    });

    expect(result.created).toBe(1);
    expect(await getDeliveryFor(db, '/posts/2026/09/new', 'nostr')).not.toBeNull();
    expect(await getDeliveryFor(db, '/posts/2026/08/old', 'nostr')).toBeNull();
  });

  it('送信済みは force 無しでは触らない', async () => {
    const db = createTestDb();
    await seed(db);
    const ctx = context(db);
    await runBackfill(ctx, { destination: 'mastodon' });
    await markSentSending(db, '/posts/2026/09/new', 'mastodon', ctx);

    const again = await runBackfill(ctx, { destination: 'mastodon' });
    expect(again).toEqual({ destination: 'mastodon', created: 0, reset: 0, skipped: 2, dryRun: false });
  });

  it('force なら送信済みもやり直せる（明示的な再配信）', async () => {
    const db = createTestDb();
    await seed(db);
    const ctx = context(db);
    await runBackfill(ctx, { destination: 'mastodon' });
    await markSentSending(db, '/posts/2026/09/new', 'mastodon', ctx);

    const forced = await runBackfill(ctx, { destination: 'mastodon', force: true });
    // sent だった1件はやり直し、送信待ちの1件はそのまま
    expect(forced).toEqual({ destination: 'mastodon', created: 0, reset: 1, skipped: 1, dryRun: false });

    const reset = await getDeliveryFor(db, '/posts/2026/09/new', 'mastodon');
    expect(reset?.status).toBe('pending');
    expect(reset?.attempt).toBe(0);
  });

  it('未実装の Destination は弾く', async () => {
    const db = createTestDb();
    await expect(
      runBackfill(context(db), { destination: 'nope' as never }),
    ).rejects.toThrow(/未実装/);
  });

  it('dry-run は予定を数えるだけで D1 を書き換えない', async () => {
    const db = createTestDb();
    await seed(db);

    const result = await runBackfill(context(db, true), { destination: 'mastodon' });

    expect(result.created).toBe(2);
    expect(result.dryRun).toBe(true);
    expect(await getDeliveryFor(db, '/posts/2026/09/new', 'mastodon')).toBeNull();
  });

  it('既に pending のものは force 無しで作り直さない', async () => {
    const db = createTestDb();
    await seed(db);
    const ctx = context(db);
    await createDelivery(db, '/posts/2026/09/new', 'mastodon', ctx.now.toISOString());

    const result = await runBackfill(ctx, { destination: 'mastodon' });
    expect(result.skipped).toBe(1);
    expect(result.created).toBe(1);
  });
});
