import type { APIRoute } from 'astro';
import { FEED_LIMIT, buildJsonFeed } from '../lib/feeds';
import { getPublishedDocuments } from '../lib/documents';

export const GET: APIRoute = async () => {
  const documents = await getPublishedDocuments();
  const feed = buildJsonFeed(documents.slice(0, FEED_LIMIT), '/feed.json');
  return new Response(`${JSON.stringify(feed, null, 2)}\n`, {
    headers: { 'Content-Type': 'application/feed+json; charset=utf-8' },
  });
};
