import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AtpAgent } from '@atproto/api';
import { createContext, type RunContext } from './context.ts';
import { DESTINATIONS } from './destinations/index.ts';
import { createTestDb } from './testing/d1.ts';
import type { Env } from './env.ts';
import { runSyndication } from './run.ts';

const FEED_URL = 'https://example.test/feed-all.json';
const TEST_PUBLICATION = 'at://did:plc:testdid/site.standard.publication/self';
const DISCORD = 'https://discord.test/webhook';

// ---- フィード ----

type ItemOptions = { title?: string; hash?: string; updatedAt?: string; text?: string };

function feedItem(path: string, options: ItemOptions = {}) {
  const slug = path.split('/').pop() ?? 'slug';
  const title = options.title ?? `タイトル ${slug}`;
  const hash = options.hash ?? `sha256:${slug}`;
  return {
    id: `https://hexx.jp${path}`,
    url: `https://hexx.jp${path}`,
    title,
    summary: `説明 ${slug}`,
    content_text: options.text ?? `本文 ${slug}`,
    date_published: '2026-09-17T12:00:00.000Z',
    ...(options.updatedAt ? { date_modified: options.updatedAt } : {}),
    tags: ['meta'],
    _hexx: {
      kind: 'post' as const,
      slug,
      path,
      title,
      description: `説明 ${slug}`,
      tags: ['meta'],
      publishedAt: '2026-09-17T12:00:00.000Z',
      ...(options.updatedAt ? { updatedAt: options.updatedAt } : {}),
      contentHash: hash,
    },
  };
}

function buildFeed(items: ReturnType<typeof feedItem>[]) {
  return {
    version: 'https://jsonfeed.org/version/1.1',
    title: 'hexx.jp',
    home_page_url: 'https://hexx.jp',
    feed_url: 'https://hexx.jp/feed-all.json',
    language: 'ja',
    items,
  };
}

const SAMPLE_PATHS = [
  '/posts/2026/09/hello-world',
  '/posts/2026/09/standard-site-memo',
  '/notes/2026/09/note-140',
];

// ---- fetch スタブ ----

const TINY_PNG = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  ),
  (c) => c.charCodeAt(0),
);

function installFetch(feed: unknown, options: { failImages?: boolean } = {}) {
  const calls: string[] = [];
  const stub = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    calls.push(url);
    if (url.startsWith(FEED_URL)) {
      return new Response(JSON.stringify(feed), {
        headers: { 'content-type': 'application/json' },
      });
    }
    if (url.endsWith('/icon-512.png') || url.includes('/images/')) {
      if (options.failImages) return new Response('nope', { status: 404 });
      return new Response(TINY_PNG, { headers: { 'content-type': 'image/png' } });
    }
    if (url.startsWith(DISCORD)) return new Response('', { status: 204 });
    throw new Error(`想定外の fetch: ${url}`);
  });
  vi.stubGlobal('fetch', stub);
  return calls;
}

// ---- ATProto エージェントのフェイク ----

type FakeAgent = {
  agent: AtpAgent;
  putRecords: Array<{ collection: string; rkey: string; record: Record<string, unknown> }>;
  deleted: string[];
  createdPosts: number;
};

function createFakeAgent(): FakeAgent {
  const putRecords: FakeAgent['putRecords'] = [];
  const deleted: string[] = [];
  const store = new Map<string, Record<string, unknown>>();
  const state = { createdPosts: 0 };

  const agent = {
    session: { did: 'did:plc:testdid' },
    com: {
      atproto: {
        repo: {
          async getRecord({ collection, rkey }: { collection: string; rkey: string }) {
            const value = store.get(`${collection}/${rkey}`);
            if (!value) throw new Error('RecordNotFound');
            return { data: { uri: `at://did:plc:testdid/${collection}/${rkey}`, value } };
          },
          async putRecord({
            collection,
            rkey,
            record,
          }: {
            collection: string;
            rkey: string;
            record: Record<string, unknown>;
          }) {
            store.set(`${collection}/${rkey}`, record);
            putRecords.push({ collection, rkey, record });
            return { data: { uri: `at://did:plc:testdid/${collection}/${rkey}`, cid: 'bafy-test' } };
          },
          async createRecord({ collection }: { collection: string }) {
            state.createdPosts += 1;
            return {
              data: {
                uri: `at://did:plc:testdid/${collection}/post${state.createdPosts}`,
                cid: `bafy-post${state.createdPosts}`,
              },
            };
          },
          async deleteRecord({ collection, rkey }: { collection: string; rkey: string }) {
            store.delete(`${collection}/${rkey}`);
            deleted.push(`${collection}/${rkey}`);
            return { data: {} };
          },
          async uploadBlob() {
            return {
              data: {
                blob: { $type: 'blob', ref: { $link: 'bafk-test' }, mimeType: 'image/png', size: 68 },
              },
            };
          },
        },
      },
    },
  };

  return {
    agent: agent as unknown as AtpAgent,
    get putRecords() {
      return putRecords;
    },
    get deleted() {
      return deleted;
    },
    get createdPosts() {
      return state.createdPosts;
    },
  } as FakeAgent;
}

// ---- 環境 ----

function makeContext(options: {
  db: D1Database;
  dryRun?: boolean;
  destinations?: string;
  now?: Date;
  fake?: FakeAgent;
  notifications?: boolean;
}): RunContext {
  const env = {
    DB: options.db,
    FEED_URL,
    // 資格情報の有無で結果が変わらないよう、テストでは常に設定済みにしておく
    BSKY_HANDLE: 'hexx.jp',
    BSKY_APP_PASSWORD: 'test-password',
    PUBLICATION_AT_URI: TEST_PUBLICATION,
    ENABLED_DESTINATIONS: options.destinations ?? 'bluesky',
    ...(options.dryRun ? { DRY_RUN: 'true' } : {}),
    ...(options.notifications ? { DISCORD_WEBHOOK_URL: DISCORD } : {}),
  } as Env;

  const context = createContext(env, 'test');
  if (options.now) context.now = options.now;
  if (options.fake) context.bsky = options.fake.agent;
  return context;
}

const originalMastodon = DESTINATIONS.mastodon;

afterEach(() => {
  vi.unstubAllGlobals();
  DESTINATIONS.mastodon = originalMastodon;
});

// ---- テスト ----

describe('runSyndication: 差分と Delivery', () => {
  it('新規 Document ごとに Delivery を作り、dry-run でも送信内容を記録する', async () => {
    const db = createTestDb();
    installFetch(buildFeed(SAMPLE_PATHS.map((path) => feedItem(path))));

    const summary = await runSyndication(makeContext({ db, dryRun: true }));

    expect(summary.feedItems).toBe(3);
    expect(summary.insert).toBe(3);
    expect(summary.records).toBe(0);
    expect(summary.deliveries.sent).toBe(3);
    expect(summary.deliveries.retrying).toBe(0);

    const deliveries = await db.prepare('SELECT * FROM delivery ORDER BY path').all<{
      path: string;
      status: string;
      action: string;
    }>();
    expect(deliveries.results.map((row) => [row.path, row.status, row.action])).toEqual([
      ['/notes/2026/09/note-140', 'sent', 'publish'],
      ['/posts/2026/09/hello-world', 'sent', 'publish'],
      ['/posts/2026/09/standard-site-memo', 'sent', 'publish'],
    ]);

    const records = await db.prepare('SELECT COUNT(*) AS n FROM document_record').first<{ n: number }>();
    expect(records?.n).toBe(0);
  });

  it('2 回目は差分が無いので何も配信しない（冪等）', async () => {
    const db = createTestDb();
    installFetch(buildFeed(SAMPLE_PATHS.map((path) => feedItem(path))));
    await runSyndication(makeContext({ db, dryRun: true }));

    const second = await runSyndication(makeContext({ db, dryRun: true }));
    expect(second.insert).toBe(0);
    expect(second.update).toBe(0);
    expect(second.deliveries.processed).toBe(0);
  });

  it('内容が変わったら update になり、SNS へは再投稿しない', async () => {
    const db = createTestDb();
    installFetch(buildFeed(SAMPLE_PATHS.map((path) => feedItem(path))));
    await runSyndication(makeContext({ db, dryRun: true }));

    installFetch(
      buildFeed(
        SAMPLE_PATHS.map((path, index) =>
          feedItem(path, index === 0 ? { hash: 'sha256:changed', text: '書き直した' } : {}),
        ),
      ),
    );
    const second = await runSyndication(makeContext({ db, dryRun: true }));

    expect(second.update).toBe(1);
    expect(second.deliveries.processed).toBe(0);
  });

  it('フィードから消えたらレコードを消し、送信済みの投稿も取り消す', async () => {
    const db = createTestDb();
    installFetch(buildFeed(SAMPLE_PATHS.map((path) => feedItem(path))));
    await runSyndication(makeContext({ db, dryRun: true }));

    installFetch(buildFeed(SAMPLE_PATHS.slice(1).map((path) => feedItem(path))));
    const second = await runSyndication(makeContext({ db, dryRun: true }));

    expect(second.unpublish).toBe(1);
    expect(second.deliveries.deleted).toBe(1);

    const row = await db
      .prepare('SELECT status, action FROM delivery WHERE path = ?')
      .bind('/posts/2026/09/hello-world')
      .first<{ status: string; action: string }>();
    expect(row).toEqual({ status: 'deleted', action: 'delete' });
  });

  it('フィードが空なら unpublish を見送る（壊れたデプロイで全消ししない）', async () => {
    const db = createTestDb();
    installFetch(buildFeed(SAMPLE_PATHS.map((path) => feedItem(path))));
    await runSyndication(makeContext({ db, dryRun: true }));

    installFetch(buildFeed([]));
    const second = await runSyndication(makeContext({ db, dryRun: true }));

    expect(second.skippedUnpublish).toBe(3);
    expect(second.unpublish).toBe(0);
    expect(second.deliveries.deleted).toBe(0);
  });
});

describe('runSyndication: ATProto レコード', () => {
  it('publication を1回だけ作り、Document を slug の rkey で書く', async () => {
    const db = createTestDb();
    const fake = createFakeAgent();
    installFetch(buildFeed(SAMPLE_PATHS.map((path) => feedItem(path))));

    const summary = await runSyndication(makeContext({ db, fake }));

    expect(summary.publicationSynced).toBe(true);
    expect(summary.records).toBe(3);
    expect(summary.deliveries.sent).toBe(3);

    const publications = fake.putRecords.filter((row) => row.collection === 'site.standard.publication');
    expect(publications).toHaveLength(1);
    expect(publications[0]?.rkey).toBe('self');
    expect(publications[0]?.record).toMatchObject({
      $type: 'site.standard.publication',
      url: 'https://hexx.jp',
      preferences: { showInDiscover: true },
    });

    const documents = fake.putRecords.filter((row) => row.collection === 'site.standard.document');
    // 初回書き込みと、Bluesky 投稿後の bskyPostRef 書き戻しの両方が入る
    expect([...new Set(documents.map((row) => row.rkey))].sort()).toEqual([
      'hello-world',
      'note-140',
      'standard-site-memo',
    ]);
    expect(documents.filter((row) => 'bskyPostRef' in row.record)).toHaveLength(3);
    const helloWorld = documents.find((row) => row.rkey === 'hello-world');
    expect(helloWorld?.record).toMatchObject({
      $type: 'site.standard.document',
      site: TEST_PUBLICATION,
      path: '/posts/2026/09/hello-world',
      title: 'タイトル hello-world',
      textContent: '本文 hello-world',
      tags: ['meta'],
    });

    // 2 回目の run ではレコードを書き直さない（bskyPostRef の書き戻し分も増えない）
    const beforeSecond = documents.length;
    installFetch(buildFeed(SAMPLE_PATHS.map((path) => feedItem(path))));
    const second = await runSyndication(makeContext({ db, fake }));
    expect(second.records).toBe(0);
    expect(second.deliveries.processed).toBe(0);
    expect(fake.putRecords.filter((row) => row.collection === 'site.standard.document')).toHaveLength(
      beforeSecond,
    );
  });

  it('Bluesky への配信後、document レコードに bskyPostRef を書き戻す', async () => {
    const db = createTestDb();
    const fake = createFakeAgent();
    installFetch(buildFeed([feedItem('/posts/2026/09/hello-world')]));

    await runSyndication(makeContext({ db, fake }));

    const documents = fake.putRecords.filter((row) => row.collection === 'site.standard.document');
    const last = documents.at(-1);
    expect(last?.record).toMatchObject({
      bskyPostRef: {
        uri: 'at://did:plc:testdid/app.bsky.feed.post/post1',
        cid: 'bafy-post1',
      },
    });

    const record = await db
      .prepare('SELECT bsky_post_uri, state FROM document_record WHERE path = ?')
      .bind('/posts/2026/09/hello-world')
      .first<{ bsky_post_uri: string; state: string }>();
    expect(record).toEqual({
      bsky_post_uri: 'at://did:plc:testdid/app.bsky.feed.post/post1',
      state: 'live',
    });
  });

  it('非公開になった Document のレコードを削除する', async () => {
    const db = createTestDb();
    const fake = createFakeAgent();
    installFetch(buildFeed([feedItem('/posts/2026/09/hello-world'), feedItem('/notes/2026/09/note-140')]));
    await runSyndication(makeContext({ db, fake }));

    installFetch(buildFeed([feedItem('/notes/2026/09/note-140')]));
    await runSyndication(makeContext({ db, fake }));

    expect(fake.deleted).toContain('site.standard.document/hello-world');
    const record = await db
      .prepare('SELECT state FROM document_record WHERE path = ?')
      .bind('/posts/2026/09/hello-world')
      .first<{ state: string }>();
    expect(record?.state).toBe('deleted');
  });

  it('publication がプレースホルダのままならレコードを書かずに失敗する', async () => {
    const db = createTestDb();
    const fake = createFakeAgent();
    installFetch(buildFeed([feedItem('/posts/2026/09/hello-world')]));
    const context = makeContext({ db, fake });
    context.publicationAtUri = 'at://did:plc:REPLACE_ME/site.standard.publication/self';

    await expect(runSyndication(context)).rejects.toThrow(/プレースホルダ/);
  });
});

describe('runSyndication: 複数の宛先', () => {
  it('1つの宛先が失敗しても、他の宛先の配信は成立する', async () => {
    const db = createTestDb();
    const fake = createFakeAgent();
    installFetch(buildFeed([feedItem('/posts/2026/09/hello-world')]));

    DESTINATIONS.mastodon = {
      id: 'mastodon',
      label: 'Mastodon',
      isConfigured: () => true,
      async publish() {
        throw new Error('mastodon down');
      },
      async remove() {},
    };

    const summary = await runSyndication(
      makeContext({ db, fake, destinations: 'bluesky,mastodon' }),
    );

    expect(summary.insert).toBe(1);
    expect(summary.deliveries.sent).toBe(1);
    expect(summary.deliveries.retrying).toBe(1);

    const rows = await db
      .prepare('SELECT destination, status, attempt FROM delivery ORDER BY destination')
      .all<{ destination: string; status: string; attempt: number }>();
    expect(rows.results).toEqual([
      { destination: 'bluesky', status: 'sent', attempt: 0 },
      { destination: 'mastodon', status: 'pending', attempt: 1 },
    ]);

    // Bluesky の投稿は成立しているので bskyPostRef も書き戻される
    expect(fake.createdPosts).toBe(1);
  });
});

describe('runSyndication: 再試行', () => {
  it('失敗するとバックオフして再試行し、上限で dead になる', async () => {
    const db = createTestDb();
    installFetch(buildFeed([feedItem('/posts/2026/09/hello-world')]));

    let attempts = 0;
    DESTINATIONS.mastodon = {
      id: 'mastodon',
      label: 'Mastodon',
      isConfigured: () => true,
      async publish() {
        attempts += 1;
        throw new Error('boom');
      },
      async remove() {},
    };

    let now = new Date('2026-09-18T00:00:00.000Z');
    const first = await runSyndication(
      makeContext({ db, dryRun: true, destinations: 'mastodon', now, notifications: true }),
    );
    expect(first.deliveries.retrying).toBe(1);

    const afterFirst = await db
      .prepare('SELECT status, attempt, next_attempt_at FROM delivery')
      .first<{ status: string; attempt: number; next_attempt_at: string }>();
    expect(afterFirst).toEqual({
      status: 'pending',
      attempt: 1,
      next_attempt_at: '2026-09-18T00:01:00.000Z',
    });

    // 期日を過ぎるまで進めると再試行され、5 回で dead になる
    for (let round = 0; round < 5; round += 1) {
      now = new Date(now.getTime() + 13 * 60 * 60 * 1000);
      await runSyndication(
        makeContext({ db, dryRun: true, destinations: 'mastodon', now, notifications: true }),
      );
    }

    const final = await db
      .prepare('SELECT status, attempt FROM delivery')
      .first<{ status: string; attempt: number }>();
    expect(final?.status).toBe('dead');
    expect(final?.attempt).toBeGreaterThanOrEqual(5);
    expect(attempts).toBeGreaterThanOrEqual(5);
  });

  it('未実装の Destination が有効なら dead にして通知する', async () => {
    const db = createTestDb();
    const calls = installFetch(buildFeed([feedItem('/posts/2026/09/hello-world')]));

    const removed = DESTINATIONS.threads;
    delete DESTINATIONS.threads;
    try {
      const summary = await runSyndication(
        makeContext({ db, dryRun: true, destinations: 'threads', notifications: true }),
      );
      expect(summary.deliveries.dead).toBe(1);
      expect(calls.some((url) => url.startsWith(DISCORD))).toBe(true);
      const row = await db
        .prepare('SELECT status, error FROM delivery')
        .first<{ status: string; error: string }>();
      expect(row?.status).toBe('dead');
      expect(row?.error).toMatch(/未実装/);
    } finally {
      DESTINATIONS.threads = removed;
    }
  });

  it('全 Destination を有効にしても、宛先ごとに独立して処理される', async () => {
    const db = createTestDb();
    const fake = createFakeAgent();
    // Mastodon / Misskey / Nostr / Threads / Discord は資格情報が無いので dead、Bluesky だけ届く
    installFetch(buildFeed([feedItem('/posts/2026/09/hello-world')]));

    const summary = await runSyndication(
      makeContext({
        db,
        fake,
        destinations: 'bluesky,mastodon,misskey,nostr,threads,discord',
      }),
    );

    expect(summary.deliveries.sent).toBe(1);
    expect(summary.deliveries.dead).toBe(5);

    const rows = await db
      .prepare('SELECT destination, status FROM delivery ORDER BY destination')
      .all<{ destination: string; status: string }>();
    expect(Object.fromEntries(rows.results.map((row) => [row.destination, row.status]))).toEqual({
      bluesky: 'sent',
      discord: 'dead',
      mastodon: 'dead',
      misskey: 'dead',
      nostr: 'dead',
      threads: 'dead',
    });
  });
});
