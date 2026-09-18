import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RunContext } from '../context.ts';
import { accentColor, discord } from './discord.ts';
import type { Env } from '../env.ts';
import type { DeliveryDocument, DeliveryRow, SnapshotRow } from '../types.ts';

const WEBHOOK = 'https://discord.test/api/webhooks/123/abc';

function context(env: Partial<Env> = {}, dryRun = true): RunContext {
  return {
    env: { DISCORD_WEBHOOK_URL: WEBHOOK, ...env } as Env,
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
    description: '説明文',
    tags: ['atproto'],
    publishedAt: '2026-09-17T12:00:00.000Z',
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('discord.publish', () => {
  it('dry-run では embed を組み立て、wait=true を付ける', async () => {
    const outcome = await discord.publish(context(), document(), {} as SnapshotRow);
    expect(outcome.externalUri).toBe('dry-run:discord:/posts/2026/09/hello-world');

    const request = outcome.request as { url: string; body: { embeds: Record<string, unknown>[] } };
    expect(request.url).toBe(`${WEBHOOK}?wait=true`);
    expect(request.body.embeds[0]).toMatchObject({
      title: 'はじめての投稿',
      description: '説明文',
      url: 'https://hexx.jp/posts/2026/09/hello-world',
      color: accentColor(),
      footer: { text: 'Post' },
      timestamp: '2026-09-17T12:00:00.000Z',
    });
  });

  it('Note は本文を description に使い、footer が Note になる', async () => {
    const outcome = await discord.publish(
      context(),
      document({ kind: 'note', description: undefined, textContent: '短いメモ' }),
      {} as SnapshotRow,
    );
    const request = outcome.request as { body: { embeds: Record<string, unknown>[] } };
    expect(request.body.embeds[0]).toMatchObject({
      description: '短いメモ',
      footer: { text: 'Note' },
    });
  });

  it('カバー画像があれば thumbnail を付ける', async () => {
    const outcome = await discord.publish(
      context(),
      document({ coverImageUrl: 'https://hexx.jp/images/cover.png' }),
      {} as SnapshotRow,
    );
    const request = outcome.request as { body: { embeds: Record<string, unknown>[] } };
    expect(request.body.embeds[0]?.thumbnail).toEqual({ url: 'https://hexx.jp/images/cover.png' });
  });

  it('作成されたメッセージの id を external_id として返す', async () => {
    const fetchStub = vi.fn(async () =>
      new Response(JSON.stringify({ id: 'msg-1' }), { headers: { 'content-type': 'application/json' } }),
    );
    vi.stubGlobal('fetch', fetchStub);

    const outcome = await discord.publish(context({}, false), document(), {} as SnapshotRow);
    expect(outcome.externalId).toBe('msg-1');
    expect(outcome.externalUri).toBe('https://hexx.jp/posts/2026/09/hello-world');

    const [url, init] = fetchStub.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${WEBHOOK}?wait=true`);
    expect(init.method).toBe('POST');
  });

  it('失敗したら例外にする', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('rate limited', { status: 429 })));
    await expect(discord.publish(context({}, false), document(), {} as SnapshotRow)).rejects.toThrow(
      /429/,
    );
  });
});

describe('discord.remove', () => {
  it('メッセージを削除する', async () => {
    const fetchStub = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchStub);
    await discord.remove(context({}, false), { external_id: 'msg-1' } as DeliveryRow);
    const [url, init] = fetchStub.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${WEBHOOK}/messages/msg-1`);
    expect(init.method).toBe('DELETE');
  });

  it('すでに無い場合は成功として扱う', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 })));
    await expect(
      discord.remove(context({}, false), { external_id: 'msg-1' } as DeliveryRow),
    ).resolves.toBeUndefined();
  });
});

describe('discord.isConfigured', () => {
  it('Webhook URL があるときだけ true', () => {
    expect(discord.isConfigured({ DISCORD_WEBHOOK_URL: WEBHOOK } as Env)).toBe(true);
    expect(discord.isConfigured({} as Env)).toBe(false);
  });
});
