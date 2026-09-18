import { PUBLICATION_AT_URI, SITE_URL } from '@hexx/shared';

export type Env = {
  DB: D1Database;

  /** デプロイフック用の共有シークレット */
  SYNDICATE_SECRET?: string;
  /** 読み取り API / 管理操作用の Bearer トークン */
  ADMIN_TOKEN?: string;

  BSKY_HANDLE?: string;
  BSKY_APP_PASSWORD?: string;

  MASTODON_INSTANCE_URL?: string;
  MASTODON_TOKEN?: string;

  MISSKEY_INSTANCE_URL?: string;
  MISSKEY_TOKEN?: string;

  /** `nsec1...` か 64桁の hex */
  NOSTR_NSEC?: string;
  /** カンマ区切りのリレー URL */
  NOSTR_RELAYS?: string;

  /** 配信先としての Discord チャンネル */
  DISCORD_WEBHOOK_URL?: string;
  /** 運用通知の Discord チャンネル。未設定なら DISCORD_WEBHOOK_URL を使う */
  DISCORD_NOTIFY_WEBHOOK_URL?: string;

  /** Threads のユーザー ID（トークンは D1 の credential に保存する） */
  THREADS_USER_ID?: string;

  /** カンマ区切りの有効 Destination。未設定なら 'bluesky' */
  ENABLED_DESTINATIONS?: string;
  /** ローカル検証用。既定は `${SITE_URL}/feed-all.json` */
  FEED_URL?: string;
  /** 検証用の上書き。既定は `packages/shared/config.json` の値 */
  PUBLICATION_AT_URI?: string;
  /** 'true' なら送信もレコード書き込みもせず、計画と Dry-run 結果だけを記録する */
  DRY_RUN?: string;
};

export type DestinationId = 'bluesky' | 'mastodon' | 'misskey' | 'nostr' | 'threads' | 'discord';

export const ALL_DESTINATIONS: readonly DestinationId[] = [
  'bluesky',
  'mastodon',
  'misskey',
  'nostr',
  'threads',
  'discord',
] as const;

export const siteUrl = SITE_URL;

export function feedUrl(env: Env): string {
  return env.FEED_URL ?? `${SITE_URL}/feed-all.json`;
}

/** publication の AT-URI。既定は config.json、検証時のみ env で上書きできる */
export function publicationAtUri(env: Env): string {
  return env.PUBLICATION_AT_URI ?? PUBLICATION_AT_URI;
}

export function isPlaceholderAtUri(atUri: string): boolean {
  return atUri.includes('REPLACE_ME');
}

export function isDryRun(env: Env): boolean {
  return env.DRY_RUN === 'true';
}

/**
 * 有効な Destination。
 * 未設定なら bluesky、明示的に空文字なら「何も配信しない」（緊急停止に使う）。
 */
export function enabledDestinations(env: Env): DestinationId[] {
  const raw = env.ENABLED_DESTINATIONS;
  if (raw === undefined) return ['bluesky'];
  return raw
    .split(',')
    .map((value) => value.trim())
    .filter((value): value is DestinationId =>
      (ALL_DESTINATIONS as readonly string[]).includes(value),
    );
}

export const DEFAULT_MISSKEY_INSTANCE_URL = 'https://misskey.io';

/** sns-client と同じ固定リレーセット（日本語圏のリレーを含む） */
export const DEFAULT_NOSTR_RELAYS = [
  'wss://yabu.me',
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.nostr.band',
  'wss://relay.primal.net',
  'wss://nostr.hiroba.media',
] as const;

export function mastodonInstanceUrl(env: Env): string {
  return (env.MASTODON_INSTANCE_URL ?? '').replace(/\/+$/, '');
}

export function misskeyInstanceUrl(env: Env): string {
  return (env.MISSKEY_INSTANCE_URL ?? DEFAULT_MISSKEY_INSTANCE_URL).replace(/\/+$/, '');
}

export function nostrRelays(env: Env): string[] {
  if (!env.NOSTR_RELAYS) return [...DEFAULT_NOSTR_RELAYS];
  const relays = env.NOSTR_RELAYS.split(',')
    .map((relay) => relay.trim())
    .filter((relay) => relay.startsWith('wss://') || relay.startsWith('ws://'));
  return relays.length > 0 ? relays : [...DEFAULT_NOSTR_RELAYS];
}

/** AT-URI から authority（DID）を取り出す */
export function didFromAtUri(atUri: string): string {
  return atUri.replace(/^at:\/\//, '').split('/')[0] ?? '';
}
