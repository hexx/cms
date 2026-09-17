import { describe, expect, it } from 'vitest';
import { documentPath, documentAtUri, formatJstDate, jstParts } from './document.ts';
import { markdownToText } from './markdown.ts';
import { canonicalJson, contentHash } from './hash.ts';
import { graphemeLength } from './grapheme.ts';
import { documentFrontmatterSchema } from './content.ts';

describe('jstParts', () => {
  it('UTC の日付を JST のカレンダーに直す', () => {
    // 2026-08-31T23:00:00Z は JST では 2026-09-01
    expect(jstParts(new Date('2026-08-31T23:00:00Z'))).toEqual({
      year: '2026',
      month: '09',
      day: '01',
    });
  });

  it('JST オフセット付きの入力をそのまま読む', () => {
    expect(jstParts(new Date('2026-09-01T00:30:00+09:00'))).toEqual({
      year: '2026',
      month: '09',
      day: '01',
    });
  });
});

describe('documentPath', () => {
  it('kind ごとのディレクトリと JST の年月で URL を作る', () => {
    const date = new Date('2026-08-31T23:00:00Z');
    expect(documentPath('post', date, 'hello-world')).toBe('/posts/2026/09/hello-world');
    expect(documentPath('note', date, 'first-note')).toBe('/notes/2026/09/first-note');
  });
});

describe('documentAtUri', () => {
  it('publication の authority を流用して document の AT-URI を作る', () => {
    expect(documentAtUri('at://did:plc:abc123/site.standard.publication/self', 'hello-world')).toBe(
      'at://did:plc:abc123/site.standard.document/hello-world',
    );
  });
});

describe('formatJstDate', () => {
  it('表示用の日付は JST 基準', () => {
    expect(formatJstDate(new Date('2026-08-31T23:00:00Z'))).toBe('2026-09-01');
  });
});

describe('markdownToText', () => {
  it('見出し・強調・インラインコードを落とす', () => {
    const text = markdownToText('## 見出し\n\nこれは**強調**と`コード`です。\n');
    expect(text).toBe('見出し\n\nこれは強調とコードです。');
  });

  it('リンクは表示テキストを残し、URL が異なれば添える', () => {
    expect(markdownToText('[記事](https://example.com/a)')).toBe('記事 <https://example.com/a>');
    expect(markdownToText('<https://example.com/a>')).toBe('https://example.com/a');
    expect(markdownToText('[https://example.com/a](https://example.com/a)')).toBe(
      'https://example.com/a',
    );
  });

  it('コードブロックとリストを素のテキストにする', () => {
    const text = markdownToText('- 一つ目\n- 二つ目\n\n```js\nconst a = 1;\n```\n');
    expect(text).toBe('- 一つ目\n- 二つ目\n\nconst a = 1;');
  });

  it('画像は alt を残す', () => {
    expect(markdownToText('![代替テキスト](/images/a.png)')).toBe('代替テキスト');
  });

  it('連続する空行を2つまでに畳む', () => {
    expect(markdownToText('a\n\n\n\n\nb')).toBe('a\n\nb');
  });
});

describe('contentHash', () => {
  it('キー順に依存しない', async () => {
    const a = await contentHash({ title: 'a', path: '/p', tags: ['x'] });
    const b = await contentHash({ tags: ['x'], path: '/p', title: 'a' });
    expect(a).toBe(b);
    expect(a).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('値が変われば変わる', async () => {
    const a = await contentHash({ title: 'a' });
    const b = await contentHash({ title: 'b' });
    expect(a).not.toBe(b);
  });

  it('canonicalJson は undefined のキーを落とす', () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe('{"a":1}');
  });
});

describe('graphemeLength', () => {
  it('絵文字を1文字として数える', () => {
    expect(graphemeLength('👨‍👩‍👧‍👦')).toBe(1);
    expect(graphemeLength('こんにちは')).toBe(5);
  });
});

describe('documentFrontmatterSchema', () => {
  const base = { title: 'タイトル', publishedAt: '2026-09-01T12:00:00+09:00' };

  it('既定値を補う', () => {
    const parsed = documentFrontmatterSchema.parse(base);
    expect(parsed.draft).toBe(false);
    expect(parsed.lang).toBe('ja');
  });

  it('updatedAt が publishedAt より前なら弾く', () => {
    const result = documentFrontmatterSchema.safeParse({
      ...base,
      updatedAt: '2026-08-01T00:00:00+09:00',
    });
    expect(result.success).toBe(false);
  });

  it('coverImage は絶対パスに限る', () => {
    expect(documentFrontmatterSchema.safeParse({ ...base, coverImage: 'images/a.png' }).success).toBe(
      false,
    );
    expect(documentFrontmatterSchema.safeParse({ ...base, coverImage: '/images/a.png' }).success).toBe(
      true,
    );
  });

  it('タグは5件まで', () => {
    const tags = ['a', 'b', 'c', 'd', 'e'];
    expect(documentFrontmatterSchema.safeParse({ ...base, tags }).success).toBe(true);
    expect(documentFrontmatterSchema.safeParse({ ...base, tags: [...tags, 'f'] }).success).toBe(false);
  });
});
