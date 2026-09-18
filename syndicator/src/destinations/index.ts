import type { DestinationId } from '../env.ts';
import { bluesky } from './bluesky.ts';
import { discord } from './discord.ts';
import { mastodon } from './mastodon.ts';
import { misskey } from './misskey.ts';
import { nostr } from './nostr.ts';
import { threads } from './threads.ts';
import type { Destination } from './types.ts';

/**
 * 実装済みの Destination。ここに無い ID が有効化されていたら、
 * その Delivery は dead にして Discord へ通知する。
 */
export const DESTINATIONS: Partial<Record<DestinationId, Destination>> = {
  bluesky,
  mastodon,
  misskey,
  nostr,
  threads,
  discord,
};

export function getDestination(id: string): Destination | undefined {
  return DESTINATIONS[id as DestinationId];
}

export type { Destination, PublishOutcome } from './types.ts';
