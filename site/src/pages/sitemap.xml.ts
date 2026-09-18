import type { APIRoute } from 'astro';
import { buildSitemap, type SitemapEntry } from '../lib/feeds';
import { collectTags, getPublishedDocuments } from '../lib/documents';

export const GET: APIRoute = async () => {
  const documents = await getPublishedDocuments();
  const entries: SitemapEntry[] = [
    { path: '/' },
    { path: '/posts' },
    { path: '/notes' },
    { path: '/tags' },
    { path: '/about' },
    ...collectTags(documents).map(({ tag }) => ({
      path: `/tags/${encodeURIComponent(tag)}`,
    })),
    ...documents.map((doc) => ({
      path: doc.path,
      lastmod: doc.updatedAt ?? doc.publishedAt,
    })),
  ];

  return new Response(buildSitemap(entries), {
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
  });
};
