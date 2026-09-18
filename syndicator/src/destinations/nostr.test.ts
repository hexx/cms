import { afterEach, describe, expect, it, vi } from 'vitest';
import { bech32 } from '@scure/base';
import type { RunContext } from '../context.ts';
import type { Env } from '../env.ts';
import type { DeliveryDocument, DeliveryRow, SnapshotRow } from '../types.ts';
import {
  buildEvent,
  decodeSecretKey,
  eventId,
  nostr,
  publishToRelays,
  resetRelayTransport,
  setRelayTransport,
  verifyEvent,
  type NostrEvent,
  type RelayResult,
} from './nostr.ts';

const TEST_SK_HEX = '01'.repeat(32);
// BIP340 のテストベクタ（sk = 0x0101...01）
const TEST_PUBKEY = '1b84c5567b126440995d3ed5aaba0565d71e1834604819ff9c17f5e9d5dd078f';

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i += 1) bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

const TEST_NSEC = bech32.encode('nsec', bech32.toWords(hexToBytes(TEST_SK_HEX)));

function context(env: Partial<Env> = {}, dryRun = true): RunContext {
  return {
    env: { NOSTR_NSEC: TEST_NSEC, ...env } as Env,
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
  resetRelayTransport();
  vi.unstubAllGlobals();
});

describe('decodeSecretKey', () => {
  it('hex と nsec が同じ鍵になる', () => {
    expect([...decodeSecretKey(TEST_SK_HEX)]).toEqual([...decodeSecretKey(TEST_NSEC)]);
    expect(decodeSecretKey(TEST_NSEC)).toHaveLength(32);
  });

  it('不正な形式は弾く', () => {
    expect(() => decodeSecretKey('npub1xxxx')).toThrow(/nsec/);
    expect(() => decodeSecretKey('short')).toThrow(/nsec/);
  });
});

describe('buildEvent', () => {
  const event = buildEvent({
    secretKey: decodeSecretKey(TEST_NSEC),
    kind: 1,
    content: 'こんにちは',
    tags: [['t', 'atproto']],
    createdAt: 1_789_000_000,
  });

  it('NIP-01 の id と有効な署名を持つ', () => {
    expect(event.pubkey).toBe(TEST_PUBKEY);
    expect(event.id).toBe(
      eventId({
        pubkey: event.pubkey,
        created_at: event.created_at,
        kind: event.kind,
        tags: event.tags,
        content: event.content,
      }),
    );
    expect(verifyEvent(event)).toBe(true);
  });

  it('内容を改竄すると検証が落ちる', () => {
    expect(verifyEvent({ ...event, content: '書き換え' })).toBe(false);
  });

  it('同じ入力なら同じ id になる（署名は補助乱数で変わりうるがどちらも有効）', () => {
    const again = buildEvent({
      secretKey: decodeSecretKey(TEST_NSEC),
      kind: 1,
      content: 'こんにちは',
      tags: [['t', 'atproto']],
      createdAt: 1_789_000_000,
    });
    expect(again.id).toBe(event.id);
    expect(verifyEvent(again)).toBe(true);
  });
});

describe('nostr.publish', () => {
  it('dry-run では署名済みイベントを組み立てて送らない', async () => {
    const outcome = await nostr.publish(context(), document(), {} as SnapshotRow);
    expect(outcome.externalUri).toBe('dry-run:nostr:/posts/2026/09/hello-world');

    const request = outcome.request as { relays: string[]; event: NostrEvent };
    expect(request.relays.length).toBeGreaterThan(0);
    expect(request.event.kind).toBe(1);
    expect(request.event.content).toBe(
      'はじめての投稿\nhttps://hexx.jp/posts/2026/09/hello-world\n#atproto',
    );
    expect(request.event.tags).toEqual([
      ['t', 'atproto'],
      ['r', 'https://hexx.jp/posts/2026/09/hello-world'],
    ]);
    expect(verifyEvent(request.event)).toBe(true);
  });

  it('NOSTR_NSEC が無くても dry-run なら計画だけ返す', async () => {
    const outcome = await nostr.publish(
      context({ NOSTR_NSEC: undefined }),
      document(),
      {} as SnapshotRow,
    );
    const request = outcome.request as { kind: number; content: string };
    expect(request.kind).toBe(1);
    expect(request.content).toContain('https://hexx.jp/posts/2026/09/hello-world');
  });

  it('受理したリレーが1つでもあれば成功にする', async () => {
    const sent: NostrEvent[] = [];
    setRelayTransport(async (relay, event): Promise<RelayResult> => {
      sent.push(event);
      return { relay, status: relay.includes('damus') ? 'accepted' : 'rejected', message: 'no' };
    });

    const outcome = await nostr.publish(
      context({ NOSTR_RELAYS: 'wss://a.test,wss://damus.test' }, false),
      document(),
      {} as SnapshotRow,
    );

    expect(outcome.externalId).toBe(sent[0]?.id);
    expect(outcome.externalUri).toBe(`https://njump.me/${sent[0]?.id}`);
    expect(sent).toHaveLength(2);
  });

  it('どのリレーにも受理されなければ失敗にする', async () => {
    setRelayTransport(async (relay): Promise<RelayResult> => ({ relay, status: 'rejected' }));
    await expect(
      nostr.publish(context({ NOSTR_RELAYS: 'wss://a.test' }, false), document(), {} as SnapshotRow),
    ).rejects.toThrow(/受理されませんでした/);
  });

  it('NOSTR_NSEC が無ければ本番では失敗する', async () => {
    await expect(
      nostr.publish(context({ NOSTR_NSEC: undefined }, false), document(), {} as SnapshotRow),
    ).rejects.toThrow(/NOSTR_NSEC/);
  });
});

describe('nostr.remove', () => {
  it('kind 5 で取り消しイベントを publish する（NIP-09）', async () => {
    const sent: NostrEvent[] = [];
    setRelayTransport(async (relay, event): Promise<RelayResult> => {
      sent.push(event);
      return { relay, status: 'accepted' };
    });

    await nostr.remove(context({ NOSTR_RELAYS: 'wss://a.test' }, false), {
      external_id: 'a'.repeat(64),
    } as DeliveryRow);

    const deletion = sent[0];
    expect(deletion?.kind).toBe(5);
    expect(deletion?.tags).toEqual([['e', 'a'.repeat(64)]]);
    expect(verifyEvent(deletion as NostrEvent)).toBe(true);
  });

  it('external_id が無ければ何もしない', async () => {
    let called = 0;
    setRelayTransport(async (relay): Promise<RelayResult> => {
      called += 1;
      return { relay, status: 'accepted' };
    });
    await nostr.remove(context({}, false), { external_id: null } as DeliveryRow);
    expect(called).toBe(0);
  });
});

describe('publishToRelays', () => {
  it('トランスポートが例外を投げても error として集約する', async () => {
    setRelayTransport(async () => {
      throw new Error('boom');
    });
    const event = buildEvent({
      secretKey: decodeSecretKey(TEST_NSEC),
      kind: 1,
      content: 'x',
      tags: [],
      createdAt: 1,
    });
    const results = await publishToRelays(['wss://a.test', 'wss://b.test'], event);
    expect(results.map((result) => result.status)).toEqual(['error', 'error']);
  });
});
