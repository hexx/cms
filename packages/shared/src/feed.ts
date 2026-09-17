import type { DocumentKind } from './document.ts';

export const JSON_FEED_VERSION = 'https://jsonfeed.org/version/1.1';

/**
 * フィードに載る Document の機械可読な姿。
 * Syndicator はこれを見て Delivery の差分を取る（独自拡張は `_hexx` に入れる）。
 */
export type FeedDocument = {
  kind: DocumentKind;
  slug: string;
  path: string;
  title: string;
  description?: string;
  tags: string[];
  coverImage?: string;
  publishedAt: string;
  updatedAt?: string;
  contentHash: string;
};

export type JsonFeedItem = {
  id: string;
  url: string;
  title: string;
  summary?: string;
  content_text?: string;
  date_published: string;
  date_modified?: string;
  tags?: string[];
  image?: string;
  /** サイト固有の拡張（JSON Feed の予約接頭辞） */
  _hexx: FeedDocument;
};

export type HexxJsonFeed = {
  version: string;
  title: string;
  home_page_url: string;
  feed_url: string;
  description?: string;
  language?: string;
  items: JsonFeedItem[];
};
