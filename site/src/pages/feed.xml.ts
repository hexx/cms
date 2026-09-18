import type { APIRoute } from 'astro';
import { FEED_LIMIT, buildRss } from '../lib/feeds';
import { getPublishedDocuments } from '../lib/documents';

export const GET: APIRoute = async () => {
  const documents = await getPublishedDocuments();
  const xml = buildRss(documents.slice(0, FEED_LIMIT), '/feed.xml');
  return new Response(xml, {
    headers: { 'Content-Type': 'application/rss+xml; charset=utf-8' },
  });
};
