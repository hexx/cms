import type { DocumentKind } from '@hexx/shared';

export type SnapshotRow = {
  path: string;
  kind: DocumentKind;
  slug: string;
  title: string;
  description: string | null;
  /** JSON array */
  tags: string;
  cover_image_url: string | null;
  text_content: string | null;
  published_at: string;
  updated_at: string | null;
  content_hash: string;
  /** 最後に ATProto レコードへ書いた内容のハッシュ。null なら未書き込み */
  record_hash: string | null;
  first_seen_at: string;
  unpublished_at: string | null;
};

export type DocumentRecordRow = {
  path: string;
  rkey: string;
  at_uri: string;
  cid: string | null;
  bsky_post_uri: string | null;
  bsky_post_cid: string | null;
  state: 'live' | 'deleted';
  updated_at: string;
};

export type DeliveryAction = 'publish' | 'delete';
export type DeliveryStatus = 'pending' | 'sending' | 'sent' | 'dead' | 'skipped' | 'deleted';

export type DeliveryRow = {
  id: number;
  path: string;
  destination: string;
  action: DeliveryAction;
  status: DeliveryStatus;
  attempt: number;
  external_uri: string | null;
  external_id: string | null;
  error: string | null;
  next_attempt_at: string | null;
  created_at: string;
  updated_at: string;
};

/** Destination に渡す Document の姿（DB 行とフィードから組み立てる） */
export type DeliveryDocument = {
  path: string;
  slug: string;
  kind: DocumentKind;
  /** Canonical URL（絶対） */
  url: string;
  title: string;
  description?: string;
  tags: string[];
  coverImageUrl?: string;
  textContent?: string;
  publishedAt: string;
  updatedAt?: string;
};

export function parseTags(json: string): string[] {
  try {
    const parsed: unknown = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.filter((t): t is string => typeof t === 'string') : [];
  } catch {
    return [];
  }
}

export function snapshotToDocument(row: SnapshotRow, siteUrl: string): DeliveryDocument {
  return {
    path: row.path,
    slug: row.slug,
    kind: row.kind,
    url: `${siteUrl}${row.path}`,
    title: row.title,
    ...(row.description ? { description: row.description } : {}),
    tags: parseTags(row.tags),
    ...(row.cover_image_url ? { coverImageUrl: row.cover_image_url } : {}),
    ...(row.text_content ? { textContent: row.text_content } : {}),
    publishedAt: row.published_at,
    ...(row.updated_at ? { updatedAt: row.updated_at } : {}),
  };
}
