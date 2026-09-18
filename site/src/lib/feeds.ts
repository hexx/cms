import {
  CONFIG,
  JSON_FEED_VERSION,
  SITE_DESCRIPTION,
  SITE_LANGUAGE,
  SITE_NAME,
  SITE_URL,
  absoluteUrl,
  type HexxJsonFeed,
  type JsonFeedItem,
} from '@hexx/shared';
import type { Document } from './documents';

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function toItem(doc: Document): JsonFeedItem {
  return {
    id: doc.url,
    url: doc.url,
    title: doc.title,
    ...(doc.description ? { summary: doc.description } : {}),
    ...(doc.textContent ? { content_text: doc.textContent } : {}),
    date_published: doc.publishedAt.toISOString(),
    ...(doc.updatedAt ? { date_modified: doc.updatedAt.toISOString() } : {}),
    ...(doc.tags.length > 0 ? { tags: doc.tags } : {}),
    ...(doc.coverImage ? { image: absoluteUrl(doc.coverImage) } : {}),
    _hexx: {
      kind: doc.kind,
      slug: doc.slug,
      path: doc.path,
      title: doc.title,
      ...(doc.description ? { description: doc.description } : {}),
      tags: doc.tags,
      ...(doc.coverImage ? { coverImage: absoluteUrl(doc.coverImage) } : {}),
      publishedAt: doc.publishedAt.toISOString(),
      ...(doc.updatedAt ? { updatedAt: doc.updatedAt.toISOString() } : {}),
      contentHash: doc.hash,
    },
  };
}

/** JSON Feed 1.1。`_hexx` に Syndicator が必要とする情報を全部入れる */
export function buildJsonFeed(documents: Document[], feedUrl: string): HexxJsonFeed {
  return {
    version: JSON_FEED_VERSION,
    title: SITE_NAME,
    home_page_url: SITE_URL,
    feed_url: absoluteUrl(feedUrl),
    description: SITE_DESCRIPTION,
    language: SITE_LANGUAGE,
    items: documents.map(toItem),
  };
}

/** RSS 2.0 */
export function buildRss(documents: Document[], feedUrl: string): string {
  const lastBuildDate = new Date().toUTCString();
  const items = documents
    .map((doc) => {
      const categories = doc.tags.map((tag) => `      <category>${escapeXml(tag)}</category>`).join('\n');
      return `    <item>
      <title>${escapeXml(doc.title)}</title>
      <link>${escapeXml(doc.url)}</link>
      <guid isPermaLink="true">${escapeXml(doc.url)}</guid>
      <pubDate>${doc.publishedAt.toUTCString()}</pubDate>
${doc.description ? `      <description>${escapeXml(doc.description)}</description>\n` : ''}${categories ? `${categories}\n` : ''}    </item>`;
    })
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeXml(SITE_NAME)}</title>
    <link>${escapeXml(SITE_URL)}/</link>
    <description>${escapeXml(SITE_DESCRIPTION)}</description>
    <language>${escapeXml(SITE_LANGUAGE)}</language>
    <lastBuildDate>${lastBuildDate}</lastBuildDate>
    <atom:link href="${escapeXml(absoluteUrl(feedUrl))}" rel="self" type="application/rss+xml"/>
${items}
  </channel>
</rss>
`;
}

export type SitemapEntry = { path: string; lastmod?: Date };

export function buildSitemap(entries: SitemapEntry[]): string {
  const urls = entries
    .map(({ path, lastmod }) => {
      const loc = escapeXml(absoluteUrl(path));
      return `  <url><loc>${loc}</loc>${lastmod ? `<lastmod>${lastmod.toISOString()}</lastmod>` : ''}</url>`;
    })
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`;
}

export const FEED_LIMIT = CONFIG.feedLimit;
