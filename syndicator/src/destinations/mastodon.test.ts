import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RunContext } from '../context.ts';
import type { Env } from '../env.ts';
import type { DeliveryDocument, DeliveryRow, SnapshotRow } from '../types.ts';
import { mastodon } from './mastodon.ts';

function context(env: Partial<Env> = {}, dryRun = true): RunContext {
  return {
    env: {
      MASTODON_INSTANCE_URL: 'https://mastodon.example',
      MASTODON_TOKEN: 'token',
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

describe('mastodon.publish', () => {
  it('dry-run では本文・可視性・言語を組み立てて送らない', async () => {
    const outcome = await mastodon.publish(context(), document(), {} as SnapshotRow);
    expect(outcome.externalUri).toBe('dry-run:mastodon:/posts/2026/09/hello-world');
    expect(outcome.request).toEqual({
      url: 'https://mastodon.example/api/v1/statuses',
      body: {
        status: 'はじめての投稿\nhttps://hexx.jp/posts/2026/09/hello-world\n#atproto',
        language: 'ja',
        visibility: 'public',
      },
    });
  });

  it('Note は本文をそのまま使う', async () => {
    const outcome = await mastodon.publish(
      context(),
      document({ kind: 'note', textContent: '短いメモ' }),
      {} as SnapshotRow,
    );
    const request = outcome.request as { body: { status: string } };
    expect(request.body.status).toBe('短いメモ\n#atproto');
  });

  it('Bearer トークンと Idempotency-Key を付けて投稿する', async () => {
    const fetchStub = vi.fn(async () =>
      new Response(JSON.stringify({ id: '123', url: 'https://mastodon.example/@hexx/123' }), {
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchStub);

    const outcome = await mastodon.publish(context({}, false), document(), {} as SnapshotRow);

    expect(outcome.externalId).toBe('123');
    expect(outcome.externalUri).toBe('https://mastodon.example/@hexx/123');
    const [url, init] = fetchStub.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://mastodon.example/api/v1/statuses');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['Idempotency-Key']).toBe(
      'hexx:/posts/2026/09/hello-world',
    );
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer token');
  });

  it('失敗したら例外にする', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('rate limited', { status: 429 })));
    await expect(mastodon.publish(context({}, false), document(), {} as SnapshotRow)).rejects.toThrow(
      /429/,
    );
  });
});

describe('mastodon.remove', () => {
  it('external_id が無ければ何もしない', async () => {
    const fetchStub = vi.fn();
    vi.stubGlobal('fetch', fetchStub);
    await mastodon.remove(context({}, false), { external_id: null } as DeliveryRow);
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it('DELETE を投げ、すでに消えていても成功として扱う', async () => {
    const fetchStub = vi.fn(async () => new Response('', { status: 404 }));
    vi.stubGlobal('fetch', fetchStub);
    await mastodon.remove(context({}, false), { external_id: '123', external_uri: null } as DeliveryRow);
    const [url, init] = fetchStub.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://mastodon.example/api/v1/statuses/123');
    expect(init.method).toBe('DELETE');
  });

  it('失敗したら例外にする', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 500 })));
    await expect(
      mastodon.remove(context({}, false), { external_id: '123' } as DeliveryRow),
    ).rejects.toThrow(/500/);
  });
});

describe('mastodon.isConfigured', () => {
  it('インスタンス URL とトークンが揃っているときだけ true', async () => {
    expect(await mastodon.isConfigured(context())).toBe(true);
    expect(await mastodon.isConfigured(context({ MASTODON_TOKEN: undefined }))).toBe(false);
    expect(
      await mastodon.isConfigured(
        context({ MASTODON_INSTANCE_URL: undefined, MASTODON_TOKEN: undefined }),
      ),
    ).toBe(false);
  });
});
