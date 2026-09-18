import type { RunContext } from '../context.ts';
import type { DestinationId } from '../env.ts';
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
  /**
   * いま使える状態か（資格情報の有無など）。
   * Threads のように資格情報を D1 に置くものがあるため、env ではなく ctx を受け取る。
   */
  isConfigured(ctx: RunContext): Promise<boolean>;
  publish(ctx: RunContext, doc: DeliveryDocument, snapshot: SnapshotRow): Promise<PublishOutcome>;
  remove(ctx: RunContext, delivery: DeliveryRow): Promise<void>;
}
