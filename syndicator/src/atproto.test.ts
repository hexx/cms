import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AtpAgent } from '@atproto/api';
import { putDocumentRecord, putPublicationRecord } from './atproto.ts';
import type { RunContext } from './context.ts';
import type { Env } from './env.ts';
import type { SnapshotRow } from './types.ts';

const TEST_DID = 'did:plc:testdid1234567890abcdef';
const PLACEHOLDER = 'at://did:plc:REPLACE_ME/site.standard.publication/self';
const OTHER_DID = 'at://did:plc:otherdid0987654321/site.standard.publication/self';

const TINY_PNG = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  ),
  (c) => c.charCodeAt(0),
);

type PutRecordInput = {
  repo: string;
  collection: string;
  rkey: string;
  record: Record<string, unknown>;
};

function createFakeAgent() {
  const putRecords: PutRecordInput[] = [];
  const agent = {
    session: { did: TEST_DID },
    com: {
      atproto: {
        repo: {
          async putRecord(input: PutRecordInput) {
            putRecords.push(input);
            return {
              data: { uri: `at://${input.repo}/${input.collection}/${input.rkey}`, cid: 'bafy-test' },
            };
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
  return { agent: agent as unknown as AtpAgent, putRecords };
}

function context(publicationAtUri: string, fake: ReturnType<typeof createFakeAgent>): RunContext {
  return {
    env: {} as Env,
    dryRun: false,
    now: new Date('2026-10-06T00:00:00.000Z'),
    trigger: 'test',
    publicationAtUri,
    bsky: fake.agent,
    log: () => {},
  };
}

const snapshot = {
  path: '/posts/2026/10/hello',
  kind: 'post',
  slug: 'hello',
  title: 'タイトル',
  description: null,
  tags: '[]',
  cover_image_url: null,
  text_content: '本文',
  published_at: '2026-10-06T00:00:00.000Z',
  updated_at: null,
  content_hash: 'sha256:x',
  record_hash: null,
  first_seen_at: '2026-10-06T00:00:00.000Z',
  unpublished_at: null,
} as SnapshotRow;

afterEach(() => {
  vi.unstubAllGlobals();
});

/** アイコンの取得（自サイト）だけを成功させる */
function stubImageFetch() {
  const stub = vi.fn(async () => new Response(TINY_PNG, { headers: { 'content-type': 'image/png' } }));
  vi.stubGlobal('fetch', stub);
  return stub;
}

describe('putPublicationRecord', () => {
  it('プレースホルダのときはログイン中のアカウントに書く（bootstrap を止めない）', async () => {
    const fake = createFakeAgent();
    stubImageFetch();

    const result = await putPublicationRecord(context(PLACEHOLDER, fake));

    expect(result.atUri).toBe(`at://${TEST_DID}/site.standard.publication/self`);
    expect(fake.putRecords).toHaveLength(1);
    expect(fake.putRecords[0]).toMatchObject({
      repo: TEST_DID,
      collection: 'site.standard.publication',
      rkey: 'self',
    });
    expect(fake.putRecords[0]?.record).toMatchObject({
      $type: 'site.standard.publication',
      url: 'https://hexx.jp',
    });
  });

  it('publication の DID が一致していれば書く', async () => {
    const fake = createFakeAgent();
    stubImageFetch();

    const result = await putPublicationRecord(
      context(`at://${TEST_DID}/site.standard.publication/self`, fake),
    );

    expect(result.atUri).toBe(`at://${TEST_DID}/site.standard.publication/self`);
  });

  it('DID が食い違っていれば止める', async () => {
    const fake = createFakeAgent();
    stubImageFetch();

    await expect(putPublicationRecord(context(OTHER_DID, fake))).rejects.toThrow(/一致しません/);
    expect(fake.putRecords).toHaveLength(0);
  });
});

describe('putDocumentRecord', () => {
  it('プレースホルダのまま Document を書こうとしたら止める（安全装置は残っている）', async () => {
    const fake = createFakeAgent();
    stubImageFetch();

    await expect(putDocumentRecord(context(PLACEHOLDER, fake), snapshot)).rejects.toThrow(
      /一致しません/,
    );
    expect(fake.putRecords).toHaveLength(0);
  });

  it('一致していれば slug を rkey にして書く', async () => {
    const fake = createFakeAgent();
    stubImageFetch();

    const result = await putDocumentRecord(
      context(`at://${TEST_DID}/site.standard.publication/self`, fake),
      snapshot,
    );

    expect(result.rkey).toBe('hello');
    expect(fake.putRecords[0]?.record).toMatchObject({
      $type: 'site.standard.document',
      site: `at://${TEST_DID}/site.standard.publication/self`,
      path: '/posts/2026/10/hello',
      title: 'タイトル',
      textContent: '本文',
    });
  });
});
