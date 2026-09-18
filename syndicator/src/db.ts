import type { FeedEntry } from './diff.ts';
import type { DeliveryAction, DeliveryRow, DeliveryStatus, DocumentRecordRow, SnapshotRow } from './types.ts';

// ---- snapshot ----

export async function listSnapshots(db: D1Database): Promise<SnapshotRow[]> {
  const result = await db.prepare('SELECT * FROM document_snapshot ORDER BY path').all<SnapshotRow>();
  return result.results;
}

export async function getSnapshot(db: D1Database, path: string): Promise<SnapshotRow | null> {
  return db.prepare('SELECT * FROM document_snapshot WHERE path = ?').bind(path).first<SnapshotRow>();
}

export async function insertSnapshot(db: D1Database, entry: FeedEntry, now: string): Promise<void> {
  await db
    .prepare(
      `INSERT OR IGNORE INTO document_snapshot (
         path, kind, slug, title, description, tags, cover_image_url, text_content,
         published_at, updated_at, content_hash, record_hash, first_seen_at, unpublished_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, NULL)`,
    )
    .bind(
      entry.path,
      entry.kind,
      entry.slug,
      entry.title,
      entry.description ?? null,
      JSON.stringify(entry.tags),
      entry.coverImageUrl ?? null,
      entry.textContent ?? null,
      entry.publishedAt,
      entry.updatedAt ?? null,
      entry.contentHash,
      now,
    )
    .run();
}

export async function updateSnapshotContent(db: D1Database, entry: FeedEntry): Promise<void> {
  await db
    .prepare(
      `UPDATE document_snapshot SET
         kind = ?, slug = ?, title = ?, description = ?, tags = ?, cover_image_url = ?,
         text_content = ?, published_at = ?, updated_at = ?, content_hash = ?
       WHERE path = ?`,
    )
    .bind(
      entry.kind,
      entry.slug,
      entry.title,
      entry.description ?? null,
      JSON.stringify(entry.tags),
      entry.coverImageUrl ?? null,
      entry.textContent ?? null,
      entry.publishedAt,
      entry.updatedAt ?? null,
      entry.contentHash,
      entry.path,
    )
    .run();
}

export async function markRepublished(db: D1Database, path: string): Promise<void> {
  await db.prepare('UPDATE document_snapshot SET unpublished_at = NULL WHERE path = ?').bind(path).run();
}

export async function markUnpublished(db: D1Database, path: string, now: string): Promise<void> {
  await db.prepare('UPDATE document_snapshot SET unpublished_at = ? WHERE path = ?').bind(now, path).run();
}

export async function setRecordHash(
  db: D1Database,
  path: string,
  hash: string | null,
): Promise<void> {
  await db
    .prepare('UPDATE document_snapshot SET record_hash = ? WHERE path = ?')
    .bind(hash, path)
    .run();
}

/** レコードへ未反映の（または内容が変わった）Document */
export async function listSnapshotsNeedingRecord(db: D1Database): Promise<SnapshotRow[]> {
  const result = await db
    .prepare(
      `SELECT * FROM document_snapshot
       WHERE unpublished_at IS NULL
         AND (record_hash IS NULL OR record_hash <> content_hash)
       ORDER BY published_at`,
    )
    .all<SnapshotRow>();
  return result.results;
}

// ---- document record ----

export async function getDocumentRecord(
  db: D1Database,
  path: string,
): Promise<DocumentRecordRow | null> {
  return db
    .prepare('SELECT * FROM document_record WHERE path = ?')
    .bind(path)
    .first<DocumentRecordRow>();
}

export async function upsertDocumentRecord(
  db: D1Database,
  record: { path: string; rkey: string; atUri: string; cid: string | null },
  now: string,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO document_record (path, rkey, at_uri, cid, state, updated_at)
       VALUES (?, ?, ?, ?, 'live', ?)
       ON CONFLICT(path) DO UPDATE SET
         rkey = excluded.rkey, at_uri = excluded.at_uri, cid = excluded.cid,
         state = 'live', updated_at = excluded.updated_at`,
    )
    .bind(record.path, record.rkey, record.atUri, record.cid, now)
    .run();
}

export async function markRecordDeleted(db: D1Database, path: string, now: string): Promise<void> {
  await db
    .prepare("UPDATE document_record SET state = 'deleted', updated_at = ? WHERE path = ?")
    .bind(now, path)
    .run();
}

export async function setBskyRef(
  db: D1Database,
  path: string,
  uri: string,
  cid: string | null,
  now: string,
): Promise<void> {
  await db
    .prepare('UPDATE document_record SET bsky_post_uri = ?, bsky_post_cid = ?, updated_at = ? WHERE path = ?')
    .bind(uri, cid, now, path)
    .run();
}

// ---- delivery ----

export async function createDelivery(
  db: D1Database,
  path: string,
  destination: string,
  now: string,
): Promise<void> {
  await db
    .prepare(
      `INSERT OR IGNORE INTO delivery
         (path, destination, action, status, attempt, next_attempt_at, created_at, updated_at)
       VALUES (?, ?, 'publish', 'pending', 0, ?, ?, ?)`,
    )
    .bind(path, destination, now, now, now)
    .run();
}

export async function selectDueDeliveries(
  db: D1Database,
  now: string,
  limit: number,
): Promise<DeliveryRow[]> {
  const result = await db
    .prepare(
      `SELECT * FROM delivery
       WHERE status = 'pending' AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
       ORDER BY next_attempt_at, id
       LIMIT ?`,
    )
    .bind(now, limit)
    .all<DeliveryRow>();
  return result.results;
}

/**
 * Delivery を原子的に確保する。
 * `status = 'pending'` のときだけ `sending` に遷移させるので、
 * 同時に走った run が同じ行を二重に送ることはない。
 */
export async function claimDelivery(db: D1Database, id: number, now: string): Promise<boolean> {
  const result = await db
    .prepare("UPDATE delivery SET status = 'sending', updated_at = ? WHERE id = ? AND status = 'pending'")
    .bind(now, id)
    .run();
  return (result.meta?.changes ?? 0) === 1;
}

export async function markSent(
  db: D1Database,
  id: number,
  outcome: { externalUri: string; externalId?: string },
  now: string,
): Promise<void> {
  await db
    .prepare(
      `UPDATE delivery SET status = 'sent', external_uri = ?, external_id = ?, error = NULL,
         next_attempt_at = NULL, updated_at = ? WHERE id = ?`,
    )
    .bind(outcome.externalUri, outcome.externalId ?? null, now, id)
    .run();
}

export async function markDeleted(db: D1Database, id: number, now: string): Promise<void> {
  await db
    .prepare(
      `UPDATE delivery SET status = 'deleted', error = NULL, next_attempt_at = NULL, updated_at = ?
       WHERE id = ?`,
    )
    .bind(now, id)
    .run();
}

export async function markPendingRetry(
  db: D1Database,
  id: number,
  attempt: number,
  nextAttemptAt: string,
  error: string,
  now: string,
): Promise<void> {
  await db
    .prepare(
      `UPDATE delivery SET status = 'pending', attempt = ?, next_attempt_at = ?, error = ?, updated_at = ?
       WHERE id = ?`,
    )
    .bind(attempt, nextAttemptAt, error.slice(0, 1000), now, id)
    .run();
}

export async function markDead(
  db: D1Database,
  id: number,
  attempt: number,
  error: string,
  now: string,
): Promise<void> {
  await db
    .prepare(
      `UPDATE delivery SET status = 'dead', attempt = ?, next_attempt_at = NULL, error = ?, updated_at = ?
       WHERE id = ?`,
    )
    .bind(attempt, error.slice(0, 1000), now, id)
    .run();
}

/** 非公開化: 送信済みなら削除ジョブに、未送信ならスキップにする */
export async function scheduleDeletionForPath(db: D1Database, path: string, now: string): Promise<void> {
  await db
    .prepare(
      `UPDATE delivery SET action = 'delete', status = 'pending', next_attempt_at = ?, updated_at = ?
       WHERE path = ? AND status = 'sent'`,
    )
    .bind(now, now, path)
    .run();
  // 直前で delete に切り替えた行を巻き込まないよう action で絞る
  await db
    .prepare(
      `UPDATE delivery SET status = 'skipped', next_attempt_at = NULL, updated_at = ?
       WHERE path = ? AND action = 'publish' AND status IN ('pending', 'sending', 'dead')`,
    )
    .bind(now, path)
    .run();
}

export async function listDeliveries(
  db: D1Database,
  options: { status?: DeliveryStatus; path?: string; limit: number },
): Promise<DeliveryRow[]> {
  const conditions: string[] = [];
  const bindings: unknown[] = [];
  if (options.status) {
    conditions.push('status = ?');
    bindings.push(options.status);
  }
  if (options.path) {
    conditions.push('path = ?');
    bindings.push(options.path);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const result = await db
    .prepare(`SELECT * FROM delivery ${where} ORDER BY updated_at DESC, id DESC LIMIT ?`)
    .bind(...bindings, options.limit)
    .all<DeliveryRow>();
  return result.results;
}

export async function getDelivery(db: D1Database, id: number): Promise<DeliveryRow | null> {
  return db.prepare('SELECT * FROM delivery WHERE id = ?').bind(id).first<DeliveryRow>();
}

export async function requeueDelivery(db: D1Database, id: number, now: string): Promise<void> {
  await db
    .prepare(
      `UPDATE delivery SET status = 'pending', attempt = 0, next_attempt_at = ?, error = NULL,
         updated_at = ? WHERE id = ?`,
    )
    .bind(now, now, id)
    .run();
}

export async function setDeliveryAction(
  db: D1Database,
  id: number,
  action: DeliveryAction,
): Promise<void> {
  await db.prepare('UPDATE delivery SET action = ? WHERE id = ?').bind(action, id).run();
}

// ---- backfill / 運用 ----

export async function getDeliveryFor(
  db: D1Database,
  path: string,
  destination: string,
): Promise<DeliveryRow | null> {
  return db
    .prepare('SELECT * FROM delivery WHERE path = ? AND destination = ?')
    .bind(path, destination)
    .first<DeliveryRow>();
}

/** 既存の Delivery をやり直しできる状態に戻す（Backfill の force 用） */
export async function resetDelivery(
  db: D1Database,
  path: string,
  destination: string,
  now: string,
): Promise<void> {
  await db
    .prepare(
      `UPDATE delivery SET action = 'publish', status = 'pending', attempt = 0,
         error = NULL, next_attempt_at = ?, updated_at = ?
       WHERE path = ? AND destination = ?`,
    )
    .bind(now, now, path, destination)
    .run();
}

export async function lastRunStartedAt(db: D1Database): Promise<string | null> {
  const row = await db
    .prepare('SELECT started_at FROM run_log ORDER BY id DESC LIMIT 1')
    .first<{ started_at: string }>();
  return row?.started_at ?? null;
}

/** 古い実行履歴を消す（Cron が 10 分ごとなので放っておくと増え続ける） */
export async function pruneRunLog(db: D1Database, before: string): Promise<void> {
  await db.prepare('DELETE FROM run_log WHERE started_at < ?').bind(before).run();
}

// ---- credential（自動更新が必要な資格情報） ----

export type CredentialRow = {
  name: string;
  value: string;
  updated_at: string;
  expires_at: string | null;
};

export async function getCredential(db: D1Database, name: string): Promise<CredentialRow | null> {
  return db.prepare('SELECT * FROM credential WHERE name = ?').bind(name).first<CredentialRow>();
}

export async function putCredential(
  db: D1Database,
  name: string,
  value: string,
  now: string,
  expiresAt: string | null,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO credential (name, value, updated_at, expires_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(name) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at,
         expires_at = excluded.expires_at`,
    )
    .bind(name, value, now, expiresAt)
    .run();
}

// ---- run log ----

export async function insertRunLog(
  db: D1Database,
  row: { startedAt: string; trigger: string; summary: string; error?: string },
): Promise<void> {
  await db
    .prepare('INSERT INTO run_log (started_at, trigger, summary, error) VALUES (?, ?, ?, ?)')
    .bind(row.startedAt, row.trigger, row.summary, row.error ?? null)
    .run();
}

export async function listRunLogs(db: D1Database, limit: number) {
  const result = await db
    .prepare('SELECT * FROM run_log ORDER BY id DESC LIMIT ?')
    .bind(limit)
    .all<{ id: number; started_at: string; trigger: string; summary: string; error: string | null }>();
  return result.results;
}
