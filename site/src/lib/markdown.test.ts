import { describe, expect, it } from 'vitest';
import { markdownToText } from './markdown.ts';

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
