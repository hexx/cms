import type { RunContext } from '../context.ts';
import type { DestinationId, Env } from '../env.ts';
import type { DeliveryDocument, DeliveryRow, SnapshotRow } from '../types.ts';

export type PublishOutcome = {
  externalUri: string;
  externalId?: string;
  /** Bluesky のように、ATProto レコード側へ逆参照を書き戻す必要がある場合 */
  recordRef?: { uri: string; cid: string };
  /** dry-run のときに「何を送るつもりだったか」 */
  request?: unknown;
};

export interface Destination {
  id: DestinationId;
  label: string;
  /** 必要な資格情報が揃っているか */
  isConfigured(env: Env): boolean;
  publish(ctx: RunContext, doc: DeliveryDocument, snapshot: SnapshotRow): Promise<PublishOutcome>;
  remove(ctx: RunContext, delivery: DeliveryRow): Promise<void>;
}
