import { describe, expect, it } from 'vitest';
import { insertRunLog } from './db.ts';
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

  it('直前の run があるときは 202 で素通りさせる（重複実行の防止）', async () => {
    const env = makeEnv();
    await insertRunLog(env.DB, {
      startedAt: new Date().toISOString(),
      trigger: 'cron',
      summary: '{}',
    });

    const response = await app.request(
      '/syndicate',
      { method: 'POST', headers: { 'X-Syndicate-Secret': 'secret' } },
      env,
    );
    expect(response.status).toBe(202);
    const body = (await response.json()) as { skipped?: string };
    expect(body.skipped).toBe('recent-run');
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
