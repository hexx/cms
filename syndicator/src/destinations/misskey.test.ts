import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RunContext } from '../context.ts';
import type { Env } from '../env.ts';
import type { DeliveryDocument, DeliveryRow, SnapshotRow } from '../types.ts';
import { misskey } from './misskey.ts';

function context(env: Partial<Env> = {}, dryRun = true): RunContext {
  return {
    env: {
      MISSKEY_INSTANCE_URL: 'https://misskey.example',
      MISSKEY_TOKEN: 'token',
      ...env,
    } as Env,
    dryRun,
    now: new Date('2026-09-18T03:00:00.000Z'),
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

describe('misskey.publish', () => {
  it('dry-run では visibility と本文を組み立てて送らない', async () => {
    const outcome = await misskey.publish(context(), document(), {} as SnapshotRow);
    expect(outcome.externalUri).toBe('dry-run:misskey:/posts/2026/09/hello-world');
    expect(outcome.request).toEqual({
      url: 'https://misskey.example/api/notes/create',
      body: {
        visibility: 'public',
        text: 'はじめての投稿\nhttps://hexx.jp/posts/2026/09/hello-world\n#atproto',
      },
    });
  });

  it('インスタンス URL 未設定なら misskey.io を使う（既定値）', async () => {
    const outcome = await misskey.publish(
      context({ MISSKEY_INSTANCE_URL: undefined }),
      document(),
      {} as SnapshotRow,
    );
    const request = outcome.request as { url: string };
    expect(request.url).toBe('https://misskey.io/api/notes/create');
  });

  it('createdNote.id を取り出して URL を組み立てる', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ createdNote: { id: 'abc123' } }), {
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );

    const outcome = await misskey.publish(context({}, false), document(), {} as SnapshotRow);
    expect(outcome.externalId).toBe('abc123');
    expect(outcome.externalUri).toBe('https://misskey.example/notes/abc123');
  });

  it('HTTP 200 でも本文に error があれば失敗にする', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ error: { code: 'RATE_LIMIT_EXCEEDED', message: 'too fast' } }), {
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );
    await expect(misskey.publish(context({}, false), document(), {} as SnapshotRow)).rejects.toThrow(
      /too fast/,
    );
  });

  it('HTTP エラーは例外にする', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 500 })));
    await expect(misskey.publish(context({}, false), document(), {} as SnapshotRow)).rejects.toThrow(
      /500/,
    );
  });
});

describe('misskey.remove', () => {
  it('noteId を POST する', async () => {
    const fetchStub = vi.fn(async () => new Response('{}', { headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchStub);
    await misskey.remove(context({}, false), { external_id: 'abc123' } as DeliveryRow);
    const [url, init] = fetchStub.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://misskey.example/api/notes/delete');
    expect(JSON.parse(init.body as string)).toEqual({ noteId: 'abc123' });
  });

  it('NO_SUCH_NOTE は成功として扱う', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ error: { code: 'NO_SUCH_NOTE' } }), {
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );
    await expect(misskey.remove(context({}, false), { external_id: 'abc' } as DeliveryRow)).resolves.toBeUndefined();
  });

  it('その他のエラーは例外にする', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ error: { code: 'FORBIDDEN', message: 'denied' } }), {
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );
    await expect(misskey.remove(context({}, false), { external_id: 'abc' } as DeliveryRow)).rejects.toThrow(
      /denied/,
    );
  });
});

describe('misskey.isConfigured', () => {
  it('トークンが無ければ false', () => {
    expect(misskey.isConfigured({ MISSKEY_TOKEN: 't' } as Env)).toBe(true);
    expect(misskey.isConfigured({ MISSKEY_INSTANCE_URL: 'https://x' } as Env)).toBe(false);
  });
});
