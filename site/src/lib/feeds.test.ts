import { describe, expect, it } from 'vitest';
import { buildJsonFeed, buildRss, buildSitemap, escapeXml } from './feeds';
import type { Document } from './documents';

const doc = {
  kind: 'post',
  slug: 'hello-world',
  id: 'post:hello-world',
  title: 'Hello & <World>',
  description: '説明 "引用" つき',
  tags: ['atproto', 'meta'],
  coverImage: '/images/cover.png',
  publishedAt: new Date('2026-09-17T12:00:00Z'),
  updatedAt: new Date('2026-09-18T12:00:00Z'),
  lang: 'ja',
  draft: false,
  year: '2026',
  month: '09',
  path: '/posts/2026/09/hello-world',
  url: 'https://hexx.jp/posts/2026/09/hello-world',
  textContent: '本文のプレーンテキスト',
  hash: 'sha256:abc',
  entry: {} as Document['entry'],
} satisfies Document;

describe('escapeXml', () => {
  it('XML の特殊文字を実体参照にする', () => {
    expect(escapeXml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&apos;');
  });
});

describe('buildRss', () => {
  const xml = buildRss([doc], '/feed.xml');

  it('channel の必須要素を持つ', () => {
    expect(xml).toContain('<rss version="2.0"');
    expect(xml).toContain('<atom:link href="https://hexx.jp/feed.xml" rel="self"');
    expect(xml).toContain('<link>https://hexx.jp/</link>');
  });

  it('item に guid と pubDate と category を持つ', () => {
    expect(xml).toContain('<guid isPermaLink="true">https://hexx.jp/posts/2026/09/hello-world</guid>');
    expect(xml).toContain('<pubDate>Thu, 17 Sep 2026 12:00:00 GMT</pubDate>');
    expect(xml).toContain('<category>atproto</category>');
  });

  it('タイトルと説明をエスケープする', () => {
    expect(xml).toContain('<title>Hello &amp; &lt;World&gt;</title>');
    expect(xml).toContain('説明 &quot;引用&quot; つき');
  });
});

describe('buildJsonFeed', () => {
  const feed = buildJsonFeed([doc], '/feed.json');

  it('JSON Feed 1.1 の必須要素を持つ', () => {
    expect(feed.version).toBe('https://jsonfeed.org/version/1.1');
    expect(feed.home_page_url).toBe('https://hexx.jp');
    expect(feed.feed_url).toBe('https://hexx.jp/feed.json');
    expect(feed.language).toBe('ja');
  });

  it('_hexx に Syndicator 用の情報を入れる', () => {
    const item = feed.items[0]!;
    expect(item.content_text).toBe('本文のプレーンテキスト');
    expect(item.image).toBe('https://hexx.jp/images/cover.png');
    expect(item._hexx).toMatchObject({
      kind: 'post',
      slug: 'hello-world',
      path: '/posts/2026/09/hello-world',
      tags: ['atproto', 'meta'],
      coverImage: 'https://hexx.jp/images/cover.png',
      publishedAt: '2026-09-17T12:00:00.000Z',
      updatedAt: '2026-09-18T12:00:00.000Z',
      contentHash: 'sha256:abc',
    });
  });

  it('任意項目が無いときはキーを作らない', () => {
    const bare = { ...doc, description: undefined, coverImage: undefined, updatedAt: undefined };
    const item = buildJsonFeed([bare as Document], '/feed.json').items[0]!;
    expect('summary' in item).toBe(false);
    expect('image' in item).toBe(false);
    expect('date_modified' in item).toBe(false);
    expect('description' in item._hexx).toBe(false);
  });
});

describe('buildSitemap', () => {
  it('lastmod 付きの url を並べる', () => {
    const xml = buildSitemap([
      { path: '/' },
      { path: '/posts/2026/09/hello-world', lastmod: new Date('2026-09-18T00:00:00Z') },
    ]);
    expect(xml).toContain('<loc>https://hexx.jp/</loc>');
    expect(xml).toContain(
      '<loc>https://hexx.jp/posts/2026/09/hello-world</loc><lastmod>2026-09-18T00:00:00.000Z</lastmod>',
    );
    expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
  });
});
