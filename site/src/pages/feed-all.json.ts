import type { APIRoute } from 'astro';
import { buildJsonFeed } from '../lib/feeds';
import { getPublishedDocuments } from '../lib/documents';

/**
 * Syndicator 専用の全件フィード。
 * `content_text` と `_hexx` を全 Document 分含むため、Backfill の入力になる。
 * 読者向けの `/feed.json` とは別に、件数を絞らない。
 */
export const GET: APIRoute = async () => {
  const documents = await getPublishedDocuments();
  const feed = buildJsonFeed(documents, '/feed-all.json');
  return new Response(`${JSON.stringify(feed, null, 2)}\n`, {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
};
