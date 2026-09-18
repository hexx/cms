import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RunContext } from '../context.ts';
import { putCredential } from '../db.ts';
import type { Env } from '../env.ts';
import { createTestDb } from '../testing/d1.ts';
import { refreshThreadsTokenIfNeeded, setThreadsCredential } from '../threads.ts';
import type { DeliveryDocument, DeliveryRow, SnapshotRow } from '../types.ts';
import { threads } from './threads.ts';

function context(env: Partial<Env>, options: { dryRun?: boolean; now?: Date } = {}): RunContext {
  return {
    env: env as Env,
    dryRun: options.dryRun ?? true,
    now: options.now ?? new Date('2026-09-18T03:00:00.000Z'),
    trigger: 'test',
    publicationAtUri: 'at://did:plc:testdid/site.standard.publication/self',
    log: () => {},
  };
}

function document(overrides: Partial<DeliveryDocument> = {}): DeliveryDocument {
  return {
    path: '/posts/2026/09/hello-world',
    slug: 'hello-world',
    kind: 'post',
    url: 'https://hexx.jp/posts/2026/09/hello-world',
    title: 'はじめての投稿',
    tags: ['atproto'],
    publishedAt: '2026-09-17T12:00:00.000Z',
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('threads.publish', () => {
  it('dry-run では本文を組み立てて送らない', async () => {
    const db = createTestDb();
    const ctx = context({ DB: db, THREADS_USER_ID: 'user-1' });
    const outcome = await threads.publish(ctx, document(), {} as SnapshotRow);

    expect(outcome.externalUri).toBe('dry-run:threads:/posts/2026/09/hello-world');
    expect(outcome.request).toEqual({
      text: 'はじめての投稿\nhttps://hexx.jp/posts/2026/09/hello-world',
      userId: 'user-1',
    });
  });

  it('資格情報が無ければ案内つきで失敗する', async () => {
    const db = createTestDb();
    const ctx = context({ DB: db, THREADS_USER_ID: 'user-1' }, { dryRun: false });
    await expect(threads.publish(ctx, document(), {} as SnapshotRow)).rejects.toThrow(
      /credentials\/threads/,
    );
  });

  it('コンテナ作成 → publish の2段階で投稿し、permalink を返す', async () => {
    const db = createTestDb();
    const ctx = context({ DB: db, THREADS_USER_ID: 'user-1' }, { dryRun: false });
    await setThreadsCredential(ctx, { userId: 'user-1', accessToken: 'token-1' }, null);

    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString();
        calls.push(url);
        if (url.endsWith('/user-1/threads')) {
          return new Response(JSON.stringify({ id: 'container-1' }), {
            headers: { 'content-type': 'application/json' },
          });
        }
        if (url.endsWith('/user-1/threads_publish')) {
          return new Response(JSON.stringify({ id: 'thread-1' }), {
            headers: { 'content-type': 'application/json' },
          });
        }
        if (url.includes('/thread-1?fields=permalink')) {
          return new Response(JSON.stringify({ permalink: 'https://www.threads.net/@hexx/post/abc' }), {
            headers: { 'content-type': 'application/json' },
          });
        }
        throw new Error(`想定外の fetch: ${url}`);
      }),
    );

    const outcome = await threads.publish(ctx, document(), {} as SnapshotRow);
    expect(outcome.externalId).toBe('thread-1');
    expect(outcome.externalUri).toBe('https://www.threads.net/@hexx/post/abc');
    expect(calls).toEqual([
      'https://graph.threads.net/v1.0/user-1/threads',
      'https://graph.threads.net/v1.0/user-1/threads_publish',
      'https://graph.threads.net/v1.0/thread-1?fields=permalink&access_token=token-1',
    ]);
  });

  it('permalink が取れなくても投稿は成立させる', async () => {
    const db = createTestDb();
    const ctx = context({ DB: db, THREADS_USER_ID: 'user-1' }, { dryRun: false });
    await setThreadsCredential(ctx, { userId: 'user-1', accessToken: 'token-1' }, null);

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.endsWith('/user-1/threads')) {
          return new Response(JSON.stringify({ id: 'container-1' }), {
            headers: { 'content-type': 'application/json' },
          });
        }
        if (url.endsWith('/user-1/threads_publish')) {
          return new Response(JSON.stringify({ id: 'thread-1' }), {
            headers: { 'content-type': 'application/json' },
          });
        }
        return new Response('nope', { status: 500 });
      }),
    );

    const outcome = await threads.publish(ctx, document(), {} as SnapshotRow);
    expect(outcome.externalUri).toBe('https://www.threads.net/t/thread-1');
  });

  it('コンテナ作成が失敗したら例外にする', async () => {
    const db = createTestDb();
    const ctx = context({ DB: db, THREADS_USER_ID: 'user-1' }, { dryRun: false });
    await setThreadsCredential(ctx, { userId: 'user-1', accessToken: 'token-1' }, null);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('bad token', { status: 401 })));

    await expect(threads.publish(ctx, document(), {} as SnapshotRow)).rejects.toThrow(/401/);
  });
});

describe('threads.remove', () => {
  it('DELETE を投げる', async () => {
    const db = createTestDb();
    const ctx = context({ DB: db, THREADS_USER_ID: 'user-1' }, { dryRun: false });
    await setThreadsCredential(ctx, { userId: 'user-1', accessToken: 'token-1' }, null);

    const fetchStub = vi.fn(async () => new Response('{}', { headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchStub);

    await threads.remove(ctx, { external_id: 'thread-1' } as DeliveryRow);
    const [url, init] = fetchStub.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://graph.threads.net/v1.0/thread-1?access_token=token-1');
    expect(init.method).toBe('DELETE');
  });
});

describe('refreshThreadsTokenIfNeeded', () => {
  it('資格情報が無ければ何もしない', async () => {
    const db = createTestDb();
    const outcome = await refreshThreadsTokenIfNeeded(context({ DB: db }, { dryRun: false }));
    expect(outcome).toBe('skipped');
  });

  it('新しければ更新しない', async () => {
    const db = createTestDb();
    const ctx = context({ DB: db, THREADS_USER_ID: 'user-1' }, { dryRun: false });
    await setThreadsCredential(ctx, { userId: 'user-1', accessToken: 'token-1' }, null);

    const fetchStub = vi.fn();
    vi.stubGlobal('fetch', fetchStub);
    expect(await refreshThreadsTokenIfNeeded(ctx)).toBe('skipped');
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it('20時間以上経っていれば更新して D1 に保存する', async () => {
    const db = createTestDb();
    const now = new Date('2026-09-18T03:00:00.000Z');
    const ctx = context({ DB: db, THREADS_USER_ID: 'user-1' }, { dryRun: false, now });
    await putCredential(
      db,
      'threads',
      JSON.stringify({ userId: 'user-1', accessToken: 'old-token' }),
      new Date(now.getTime() - 21 * 60 * 60 * 1000).toISOString(),
      null,
    );

    const fetchStub = vi.fn(async () =>
      new Response(JSON.stringify({ access_token: 'new-token', expires_in: 5_184_000 }), {
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchStub);

    expect(await refreshThreadsTokenIfNeeded(ctx)).toBe('refreshed');
    const [url] = fetchStub.mock.calls[0] as unknown as [string];
    expect(url).toContain('grant_type=th_refresh_token');
    expect(url).toContain('access_token=old-token');

    const row = await db
      .prepare('SELECT value, expires_at FROM credential WHERE name = ?')
      .bind('threads')
      .first<{ value: string; expires_at: string }>();
    expect(JSON.parse(row?.value ?? '{}').accessToken).toBe('new-token');
    expect(row?.expires_at).toBe('2026-11-17T03:00:00.000Z'); // 60 日後
  });

  it('更新に失敗しても run は続く（failed を返す）', async () => {
    const db = createTestDb();
    const now = new Date('2026-09-18T03:00:00.000Z');
    const ctx = context({ DB: db, THREADS_USER_ID: 'user-1' }, { dryRun: false, now });
    await putCredential(
      db,
      'threads',
      JSON.stringify({ userId: 'user-1', accessToken: 'old-token' }),
      new Date(now.getTime() - 21 * 60 * 60 * 1000).toISOString(),
      null,
    );
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 500 })));

    expect(await refreshThreadsTokenIfNeeded(ctx)).toBe('failed');
  });
});

describe('threads.isConfigured', () => {
  it('THREADS_USER_ID があれば true', async () => {
    expect(await threads.isConfigured(context({ DB: createTestDb(), THREADS_USER_ID: 'user-1' }))).toBe(
      true,
    );
  });

  it('THREADS_USER_ID が無くても、D1 に資格情報があれば true', async () => {
    const db = createTestDb();
    const ctx = context({ DB: db });
    expect(await threads.isConfigured(ctx)).toBe(false);

    await setThreadsCredential(ctx, { userId: 'user-1', accessToken: 'token-1' }, null);
    expect(await threads.isConfigured(ctx)).toBe(true);
  });
});
