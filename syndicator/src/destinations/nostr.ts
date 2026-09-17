import { schnorr } from '@noble/curves/secp256k1.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bech32 } from '@scure/base';
import type { RunContext } from '../context.ts';
import type { Env } from '../env.ts';
import { nostrRelays } from '../env.ts';
import { composeSnsText, toHashtag } from '../text.ts';
import type { DeliveryDocument } from '../types.ts';
import type { Destination, PublishOutcome } from './types.ts';

const KIND_TEXT_NOTE = 1;
const KIND_DELETE = 5;
const RELAY_TIMEOUT_MS = 8_000;
/** Nostr に実質的な上限は無いが、常識的な線を引く */
const MAX_CHARS = 10_000;
const MAX_HASHTAGS = 5;

export type NostrEvent = {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
};

export type RelayStatus = 'accepted' | 'rejected' | 'timeout' | 'error';
export type RelayResult = { relay: string; status: RelayStatus; message?: string };
export type RelayTransport = (
  relay: string,
  event: NostrEvent,
  timeoutMs: number,
) => Promise<RelayResult>;

const HEX = /^[0-9a-fA-F]{64}$/;

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/** `nsec1...`（bech32）または 64 桁 hex を 32 バイトの秘密鍵にする */
export function decodeSecretKey(input: string): Uint8Array {
  const value = input.trim();
  if (value.startsWith('nsec1')) {
    const decoded = bech32.decode(value, false);
    if (decoded.prefix !== 'nsec') throw new Error(`nsec ではありません: ${decoded.prefix}`);
    const bytes = bech32.fromWords(decoded.words);
    if (bytes.length !== 32) throw new Error(`nsec の長さが不正です: ${bytes.length}`);
    return bytes;
  }
  if (HEX.test(value)) return hexToBytes(value);
  throw new Error('NOSTR_NSEC は nsec1... か 64 桁の hex で指定してください');
}

/** NIP-01 のイベント id（[0, pubkey, created_at, kind, tags, content] の SHA-256） */
export function eventId(event: {
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
}): string {
  const serialized = JSON.stringify([
    0,
    event.pubkey,
    event.created_at,
    event.kind,
    event.tags,
    event.content,
  ]);
  return bytesToHex(sha256(new TextEncoder().encode(serialized)));
}

export function buildEvent(input: {
  secretKey: Uint8Array;
  kind: number;
  content: string;
  tags: string[][];
  createdAt: number;
}): NostrEvent {
  const pubkey = bytesToHex(schnorr.getPublicKey(input.secretKey));
  const partial = {
    pubkey,
    created_at: input.createdAt,
    kind: input.kind,
    tags: input.tags,
    content: input.content,
  };
  const id = eventId(partial);
  const sig = bytesToHex(schnorr.sign(hexToBytes(id), input.secretKey));
  return { id, ...partial, sig };
}

export function verifyEvent(event: NostrEvent): boolean {
  try {
    // id が本文から再計算した値と一致していること（改竄検知）と、署名の両方を見る
    const expected = eventId({
      pubkey: event.pubkey,
      created_at: event.created_at,
      kind: event.kind,
      tags: event.tags,
      content: event.content,
    });
    if (expected !== event.id) return false;
    return schnorr.verify(hexToBytes(event.sig), hexToBytes(event.id), hexToBytes(event.pubkey));
  } catch {
    return false;
  }
}

/** WebSocket でリレーに EVENT を送り、OK の応答を待つ */
async function defaultTransport(
  relay: string,
  event: NostrEvent,
  timeoutMs: number,
): Promise<RelayResult> {
  return new Promise<RelayResult>((resolve) => {
    let settled = false;
    const socket = new WebSocket(relay);
    const timer = setTimeout(() => finish({ relay, status: 'timeout' }), timeoutMs);

    function finish(result: RelayResult): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        socket.close();
      } catch {
        // すでに閉じている場合は無視
      }
      resolve(result);
    }

    socket.addEventListener('open', () => {
      socket.send(JSON.stringify(['EVENT', event]));
    });
    socket.addEventListener('message', (message) => {
      if (typeof message.data !== 'string') return;
      try {
        const parsed = JSON.parse(message.data) as unknown;
        if (!Array.isArray(parsed) || parsed[0] !== 'OK' || parsed[1] !== event.id) return;
        finish({
          relay,
          status: parsed[2] === true ? 'accepted' : 'rejected',
          ...(typeof parsed[3] === 'string' ? { message: parsed[3] } : {}),
        });
      } catch {
        // 関係ないメッセージは無視
      }
    });
    socket.addEventListener('error', () => finish({ relay, status: 'error' }));
    socket.addEventListener('close', () => finish({ relay, status: 'error', message: 'closed' }));
  });
}

let transport: RelayTransport = defaultTransport;

/** テスト用にトランスポートを差し替える */
export function setRelayTransport(next: RelayTransport): void {
  transport = next;
}

export function resetRelayTransport(): void {
  transport = defaultTransport;
}

export async function publishToRelays(relays: string[], event: NostrEvent): Promise<RelayResult[]> {
  return Promise.all(
    relays.map((relay) =>
      transport(relay, event, RELAY_TIMEOUT_MS).catch(
        (): RelayResult => ({ relay, status: 'error' }),
      ),
    ),
  );
}

function summarize(results: RelayResult[]): string {
  return results.map((result) => `${result.relay}=${result.status}`).join(', ');
}

function buildTags(doc: DeliveryDocument): string[][] {
  const hashtags = doc.tags
    .map(toHashtag)
    .filter((tag): tag is string => tag !== null)
    .slice(0, MAX_HASHTAGS);
  return [...hashtags.map((tag) => ['t', tag]), ['r', doc.url]];
}

export const nostr: Destination = {
  id: 'nostr',
  label: 'Nostr',

  isConfigured(env: Env): boolean {
    return Boolean(env.NOSTR_NSEC);
  },

  async publish(ctx, doc): Promise<PublishOutcome> {
    const content = composeSnsText(doc, { limit: MAX_CHARS, hashtags: MAX_HASHTAGS });
    const tags = buildTags(doc);
    const relays = nostrRelays(ctx.env);

    if (!ctx.env.NOSTR_NSEC) {
      if (ctx.dryRun) {
        return { externalUri: `dry-run:nostr:${doc.path}`, request: { kind: KIND_TEXT_NOTE, content, tags, relays } };
      }
      throw new Error('NOSTR_NSEC が設定されていません');
    }

    const secretKey = decodeSecretKey(ctx.env.NOSTR_NSEC);
    const event = buildEvent({
      secretKey,
      kind: KIND_TEXT_NOTE,
      content,
      tags,
      createdAt: Math.floor(ctx.now.getTime() / 1000),
    });
    const request = { relays, event };

    if (ctx.dryRun) {
      return { externalUri: `dry-run:nostr:${doc.path}`, request };
    }

    const results = await publishToRelays(relays, event);
    if (!results.some((result) => result.status === 'accepted')) {
      throw new Error(`どのリレーにも受理されませんでした（${summarize(results)}）`);
    }
    ctx.log('info', 'Nostr へ publish しました', {
      id: event.id,
      accepted: results.filter((result) => result.status === 'accepted').length,
      total: results.length,
    });

    return { externalUri: `https://njump.me/${event.id}`, externalId: event.id, request };
  },

  async remove(ctx: RunContext, delivery): Promise<void> {
    const id = delivery.external_id;
    if (!id) return;
    const relays = nostrRelays(ctx.env);

    if (ctx.dryRun) {
      ctx.log('info', '[dry-run] Nostr のイベントを取り消します（NIP-09）', { id });
      return;
    }
    if (!ctx.env.NOSTR_NSEC) throw new Error('NOSTR_NSEC が設定されていません');

    // NIP-09: kind 5 で取り消したいイベントを指す
    const event = buildEvent({
      secretKey: decodeSecretKey(ctx.env.NOSTR_NSEC),
      kind: KIND_DELETE,
      content: '記事を非公開にしたため取り消します',
      tags: [['e', id]],
      createdAt: Math.floor(ctx.now.getTime() / 1000),
    });

    const results = await publishToRelays(relays, event);
    if (!results.some((result) => result.status === 'accepted')) {
      throw new Error(`取り消しイベントをどのリレーも受理しませんでした（${summarize(results)}）`);
    }
  },
};
