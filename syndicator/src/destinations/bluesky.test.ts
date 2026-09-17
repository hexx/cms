import { describe, expect, it } from 'vitest';
import type { RunContext } from '../context.ts';
import type { DeliveryDocument, SnapshotRow } from '../types.ts';
import { bluesky } from './bluesky.ts';

function dryRunContext(): RunContext {
  return {
    env: {},
    dryRun: true,
    now: new Date('2026-09-18T03:00:00.000Z'),
    trigger: 'test',
    log: () => {},
  } as unknown as RunContext;
}

function document(overrides: Partial<DeliveryDocument> = {}): DeliveryDocument {
  return {
    path: '/posts/2026/09/hello-world',
    slug: 'hello-world',
    kind: 'post',
    url: 'https://hexx.jp/posts/2026/09/hello-world',
    title: 'はじめての投稿',
    description: '説明文',
    tags: ['meta'],
    publishedAt: '2026-09-17T12:00:00.000Z',
    ...overrides,
  };
}

describe('bluesky.publish（dry-run）', () => {
  it('外部 embed 付きの投稿レコードを組み立てる', async () => {
    const outcome = await bluesky.publish(dryRunContext(), document(), {} as SnapshotRow);

    expect(outcome.externalUri).toBe('dry-run:bluesky:/posts/2026/09/hello-world');
    expect(outcome.request).toMatchObject({
      $type: 'app.bsky.feed.post',
      text: 'はじめての投稿',
      createdAt: '2026-09-18T03:00:00.000Z',
      langs: ['ja'],
      embed: {
        $type: 'app.bsky.embed.external',
        external: {
          uri: 'https://hexx.jp/posts/2026/09/hello-world',
          title: 'はじめての投稿',
          description: '説明文',
        },
      },
    });
  });

  it('description が無ければ本文の冒頭を使う', async () => {
    const outcome = await bluesky.publish(
      dryRunContext(),
      document({ description: undefined, textContent: '一行目\n二行目' }),
      {} as SnapshotRow,
    );
    const request = outcome.request as { embed: { external: { description: string } } };
    expect(request.embed.external.description).toBe('一行目 二行目');
  });

  it('description は 300 グラフェムに切り詰める', async () => {
    const outcome = await bluesky.publish(
      dryRunContext(),
      document({ description: 'あ'.repeat(400) }),
      {} as SnapshotRow,
    );
    const request = outcome.request as { embed: { external: { description: string } } };
    expect([...request.embed.external.description].length).toBe(300);
  });

  it('タイトルは 300 グラフェムに切り詰める', async () => {
    const outcome = await bluesky.publish(dryRunContext(), document({ title: 'あ'.repeat(400) }), {} as SnapshotRow);
    const request = outcome.request as { text: string };
    expect([...request.text].length).toBe(300);
  });

  it('dry-run では thumb を付けない（アップロードしない）', async () => {
    const outcome = await bluesky.publish(
      dryRunContext(),
      document({ coverImageUrl: 'https://hexx.jp/images/cover.png' }),
      {} as SnapshotRow,
    );
    const request = outcome.request as { embed: { external: Record<string, unknown> } };
    expect('thumb' in request.embed.external).toBe(false);
  });
});

describe('bluesky.isConfigured', () => {
  it('ハンドルと App Password が揃っているときだけ true', () => {
    expect(bluesky.isConfigured({ BSKY_HANDLE: 'a', BSKY_APP_PASSWORD: 'b' } as never)).toBe(true);
    expect(bluesky.isConfigured({ BSKY_HANDLE: 'a' } as never)).toBe(false);
    expect(bluesky.isConfigured({} as never)).toBe(false);
  });
});
