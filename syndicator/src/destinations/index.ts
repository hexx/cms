import type { DestinationId } from '../env.ts';
import { bluesky } from './bluesky.ts';
import { mastodon } from './mastodon.ts';
import { misskey } from './misskey.ts';
import { nostr } from './nostr.ts';
import type { Destination } from './types.ts';

/**
 * 実装済みの Destination。P4 で threads / discord を足す。
 * ここに無い ID が有効化されていたら、その Delivery は dead にして通知する。
 */
export const DESTINATIONS: Partial<Record<DestinationId, Destination>> = {
  bluesky,
  mastodon,
  misskey,
  nostr,
};

export function getDestination(id: string): Destination | undefined {
  return DESTINATIONS[id as DestinationId];
}

export type { Destination, PublishOutcome } from './types.ts';
