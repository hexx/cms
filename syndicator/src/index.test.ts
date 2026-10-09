import { afterEach, describe, expect, it } from 'vitest';
import {
  claimDelivery,
  createDelivery,
  getDeliveryFor,
  getSnapshot,
  insertSnapshot,
  markSent,
  tryAcquireRunLock,
} from './db.ts';
import { DESTINATIONS } from './destinations/index.ts';
import type { Env } from './env.ts';
import { app } from './index.ts';
import { createTestDb } from './testing/d1.ts';

function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    DB: createTestDb(),
    SYNDICATE_SECRET: 'secret',
    ADMIN_TOKEN: 'token',
    ...overrides,
  } as Env;
}

describe('GET /health', () => {
  it('dry-run と有効な Destination を返す', async () => {
    const response = await app.request('/health', {}, makeEnv({ DRY_RUN: 'true' }));
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.ok).toBe(true);
    expect(body.dryRun).toBe(true);
    expect(body.destinations).toEqual(['bluesky']);
  });
});

describe('POST /syndicate', () => {
  it('シークレットが無ければ 401', async () => {
    const response = await app.request(
      '/syndicate',
      { method: 'POST', headers: { 'X-Syndicate-Secret': 'wrong' } },
      makeEnv(),
    );
    expect(response.status).toBe(401);
  });

  it('別の run が実行中なら 202 で素通りさせる（重複実行の防止）', async () => {
    const env = makeEnv();
    // 実行ロックを先に取っておく
    const now = new Date().toISOString();
    expect(await tryAcquireRunLock(env.DB, now, new Date(0).toISOString(), 'cron')).toBe(true);

    const response = await app.request(
      '/syndicate',
      { method: 'POST', headers: { 'X-Syndicate-Secret': 'secret' } },
      env,
    );
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ skipped: 'locked' });
  });
});

describe('GET /v1/deliveries', () => {
  it('Bearer が無ければ 401 で、あれば一覧を返す', async () => {
    const env = makeEnv();
    expect((await app.request('/v1/deliveries', {}, env)).status).toBe(401);

    const response = await app.request(
      '/v1/deliveries',
      { headers: { Authorization: 'Bearer token' } },
      env,
    );
    expect(response.status).toBe(200);
    expect(((await response.json()) as { deliveries: unknown[] }).deliveries).toEqual([]);
  });
});

describe('POST /v1/backfill', () => {
  it('destination が無ければ 400', async () => {
    const response = await app.request(
      '/v1/backfill',
      {
        method: 'POST',
        headers: { Authorization: 'Bearer token', 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      },
      makeEnv(),
    );
    expect(response.status).toBe(400);
  });

  it('未実装の destination は 400', async () => {
    const response = await app.request(
      '/v1/backfill',
      {
        method: 'POST',
        headers: { Authorization: 'Bearer token', 'Content-Type': 'application/json' },
        body: JSON.stringify({ destination: 'nope' }),
      },
      makeEnv(),
    );
    expect(response.status).toBe(400);
  });

  it('実装済みなら Backfill の結果を返す', async () => {
    const response = await app.request(
      '/v1/backfill',
      {
        method: 'POST',
        headers: { Authorization: 'Bearer token', 'Content-Type': 'application/json' },
        body: JSON.stringify({ destination: 'misskey' }),
      },
      makeEnv(),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      destination: 'misskey',
      created: 0,
      reset: 0,
      skipped: 0,
      dryRun: false,
    });
  });
});

describe('POST /v1/credentials/threads', () => {
  it('accessToken と userId を D1 に保存する', async () => {
    const env = makeEnv();
    const response = await app.request(
      '/v1/credentials/threads',
      {
        method: 'POST',
        headers: { Authorization: 'Bearer token', 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: 'user-1', accessToken: 'token-1' }),
      },
      env,
    );
    expect(response.status).toBe(200);

    const row = await env.DB.prepare('SELECT value FROM credential WHERE name = ?')
      .bind('threads')
      .first<{ value: string }>();
    expect(JSON.parse(row?.value ?? '{}')).toEqual({ userId: 'user-1', accessToken: 'token-1' });
  });

  it('accessToken が無ければ 400', async () => {
    const response = await app.request(
      '/v1/credentials/threads',
      {
        method: 'POST',
        headers: { Authorization: 'Bearer token', 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: 'user-1' }),
      },
      makeEnv(),
    );
    expect(response.status).toBe(400);
  });
});

describe('GET /admin（認証）', () => {
  it('認証が無ければ 403', async () => {
    const response = await app.request('/admin', {}, makeEnv());
    expect(response.status).toBe(403);
  });

  it('Access ヘッダーを偽装しても通さない（署名を検証する）', async () => {
    // 「ヘッダーがあれば通す」実装だとここが 200 になってしまう
    const response = await app.request(
      '/admin',
      { headers: { 'cf-access-jwt-assertion': 'dummy' } },
      makeEnv(),
    );
    expect(response.status).toBe(403);
  });

  it('ACCESS_TEAM_DOMAIN と ACCESS_AUD が無ければ Access 経由でも通さない', async () => {
    const response = await app.request(
      '/admin',
      { headers: { 'cf-access-jwt-assertion': 'dummy' } },
      makeEnv({ ACCESS_TEAM_DOMAIN: 'https://test.cloudflareaccess.com' }),
    );
    expect(response.status).toBe(403);
  });

  it('Bearer トークンがあれば通す', async () => {
    const response = await app.request('/admin', { headers: { Authorization: 'Bearer token' } }, makeEnv());
    expect(response.status).toBe(200);
  });

  it('ADMIN_ALLOW_DIRECT=true なら通す（ローカル検証用）', async () => {
    const response = await app.request('/admin', {}, makeEnv({ ADMIN_ALLOW_DIRECT: 'true' }));
    expect(response.status).toBe(200);
  });
});

describe('POST /v1/unpublish', () => {
  const AUTH = { Authorization: 'Bearer token', 'Content-Type': 'application/json' };
  const NOW = '2026-10-06T00:00:00.000Z';
  const SAMPLE = '/posts/2026/10/sample';

  const originalBluesky = DESTINATIONS.bluesky;
  const removed: string[] = [];

  afterEach(() => {
    DESTINATIONS.bluesky = originalBluesky;
    removed.length = 0;
  });

  /** 送信済みの Document を1件用意する。Bluesky だけは取り消しを記録するフェイクにする */
  async function seedLiveDocument(env: Env, path: string = SAMPLE): Promise<void> {
    DESTINATIONS.bluesky = {
      id: 'bluesky',
      label: 'Bluesky（テスト）',
      async isConfigured() {
        return true;
      },
      async publish() {
        throw new Error('このテストでは使わない');
      },
      async remove(_ctx, delivery) {
        if (delivery.external_uri) removed.push(delivery.external_uri);
      },
    };

    await insertSnapshot(
      env.DB,
      {
        path,
        kind: 'post',
        slug: path.split('/').pop() ?? 'sample',
        title: 'サンプル',
        tags: [],
        publishedAt: NOW,
        contentHash: `sha256:${path}`,
      },
      NOW,
    );
    await createDelivery(env.DB, path, 'bluesky', NOW);
    const row = await getDeliveryFor(env.DB, path, 'bluesky');
    expect(await claimDelivery(env.DB, row!.id, NOW)).toBe(true);
    expect(
      await markSent(
        env.DB,
        row!.id,
        { externalUri: 'at://did:plc:testdid/app.bsky.feed.post/post1' },
        NOW,
      ),
    ).toBe(true);
  }

  function post(env: Env, body: unknown) {
    return app.request(
      '/v1/unpublish',
      { method: 'POST', headers: AUTH, body: JSON.stringify(body) },
      env,
    );
  }

  it('paths も all も無ければ 400', async () => {
    const response = await post(makeEnv(), {});
    expect(response.status).toBe(400);
  });

  it('DRY_RUN のときは 409（dry-run は何も変えない）', async () => {
    const response = await post(makeEnv({ DRY_RUN: 'true' }), { all: true });
    expect(response.status).toBe(409);
  });

  it('all: true で公開中の Document を非公開にし、投稿の取り消しまで進める', async () => {
    const env = makeEnv();
    await seedLiveDocument(env);

    const response = await post(env, { all: true });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { unpublished: number; paths: string[] };
    expect(body.unpublished).toBe(1);
    expect(body.paths).toEqual([SAMPLE]);

    expect((await getSnapshot(env.DB, SAMPLE))?.unpublished_at).toBeTruthy();
    expect(await getDeliveryFor(env.DB, SAMPLE, 'bluesky')).toMatchObject({
      action: 'delete',
      status: 'deleted',
    });
    expect(removed).toEqual(['at://did:plc:testdid/app.bsky.feed.post/post1']);
  });

  it('paths で対象を絞れる', async () => {
    const env = makeEnv();
    await seedLiveDocument(env, '/posts/2026/10/keep');
    await seedLiveDocument(env, '/posts/2026/10/drop');

    const body = (await (await post(env, { paths: ['/posts/2026/10/drop'] })).json()) as {
      paths: string[];
    };
    expect(body.paths).toEqual(['/posts/2026/10/drop']);
    expect((await getSnapshot(env.DB, '/posts/2026/10/keep'))?.unpublished_at).toBeNull();
    expect((await getSnapshot(env.DB, '/posts/2026/10/drop'))?.unpublished_at).toBeTruthy();
  });

  it('既に非公開のものは二度処理しない', async () => {
    const env = makeEnv();
    await seedLiveDocument(env);
    await post(env, { all: true });

    const body = (await (await post(env, { all: true })).json()) as { unpublished: number };
    expect(body.unpublished).toBe(0);
  });
});
