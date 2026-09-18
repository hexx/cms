import { z } from 'zod';

export const JSON_FEED_VERSION = 'https://jsonfeed.org/version/1.1';

/**
 * フィードに載る Document の機械可読な姿。
 * Syndicator はこれを見て Delivery の差分を取る（独自拡張は `_hexx` に入れる）。
 */
export const feedDocumentSchema = z.object({
  kind: z.enum(['post', 'note']),
  slug: z.string().min(1),
  path: z.string().startsWith('/'),
  title: z.string().min(1),
  description: z.string().optional(),
  tags: z.array(z.string()).default([]),
  coverImage: z.url().optional(),
  publishedAt: z.string(),
  updatedAt: z.string().optional(),
  contentHash: z.string().min(1),
});

export const jsonFeedItemSchema = z.object({
  id: z.string(),
  url: z.url(),
  title: z.string().min(1),
  summary: z.string().optional(),
  content_text: z.string().optional(),
  date_published: z.string(),
  date_modified: z.string().optional(),
  tags: z.array(z.string()).optional(),
  image: z.url().optional(),
  /** サイト固有の拡張（JSON Feed の予約接頭辞） */
  _hexx: feedDocumentSchema,
});

export const hexxJsonFeedSchema = z.object({
  version: z.literal(JSON_FEED_VERSION),
  title: z.string(),
  home_page_url: z.url(),
  feed_url: z.url(),
  description: z.string().optional(),
  language: z.string().optional(),
  /** 古い順でも新しい順でもよい。Syndicator は順序に依存しない */
  items: z.array(jsonFeedItemSchema),
});

export type FeedDocument = z.infer<typeof feedDocumentSchema>;
export type JsonFeedItem = z.infer<typeof jsonFeedItemSchema>;
export type HexxJsonFeed = z.infer<typeof hexxJsonFeedSchema>;
