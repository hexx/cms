import { PUBLICATION_AT_URI, SITE_URL } from '@hexx/shared';

export type Env = {
  DB: D1Database;

  /** デプロイフック用の共有シークレット */
  SYNDICATE_SECRET?: string;
  /** 読み取り API / 管理操作用の Bearer トークン */
  ADMIN_TOKEN?: string;

  BSKY_HANDLE?: string;
  BSKY_APP_PASSWORD?: string;

  DISCORD_WEBHOOK_URL?: string;

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

export function enabledDestinations(env: Env): DestinationId[] {
  const raw = env.ENABLED_DESTINATIONS;
  if (!raw) return ['bluesky'];
  return raw
    .split(',')
    .map((value) => value.trim())
    .filter((value): value is DestinationId =>
      (ALL_DESTINATIONS as readonly string[]).includes(value),
    );
}

/** AT-URI から authority（DID）を取り出す */
export function didFromAtUri(atUri: string): string {
  return atUri.replace(/^at:\/\//, '').split('/')[0] ?? '';
}
