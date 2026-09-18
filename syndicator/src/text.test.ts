import { describe, expect, it } from 'vitest';
import { composeLinkedPost, composeNoteText, composeSnsText, hashtagSuffix, toHashtag } from './text.ts';
import type { DeliveryDocument } from './types.ts';

function document(overrides: Partial<DeliveryDocument> = {}): DeliveryDocument {
  return {
    path: '/posts/2026/09/hello-world',
    slug: 'hello-world',
    kind: 'post',
    url: 'https://hexx.jp/posts/2026/09/hello-world',
    title: 'はじめての投稿',
    description: '説明',
    tags: ['atproto', 'standard-site'],
    publishedAt: '2026-09-17T12:00:00.000Z',
    ...overrides,
  };
}

describe('toHashtag', () => {
  it('先頭の # と空白を落とす', () => {
    expect(toHashtag(' #atproto ')).toBe('atproto');
    expect(toHashtag('standard site')).toBe('standardsite');
  });

  it('使えない文字を落とし、日本語は残す', () => {
    expect(toHashtag('テスト!')).toBe('テスト');
    expect(toHashtag('a.b/c')).toBe('abc');
  });

  it('空になるなら null', () => {
    expect(toHashtag('!!!')).toBeNull();
    expect(toHashtag('  ')).toBeNull();
  });
});

describe('hashtagSuffix', () => {
  it('最大数まで並べる', () => {
    expect(hashtagSuffix(['a', 'b', 'c', 'd'], 3)).toBe('#a #b #c');
  });

  it('使えないタグは数に含めない', () => {
    expect(hashtagSuffix(['a', '!!!', 'b'], 2)).toBe('#a #b');
  });

  it('1つも無ければ空文字', () => {
    expect(hashtagSuffix([], 3)).toBe('');
  });
});

describe('composeLinkedPost', () => {
  it('タイトル・URL・タグを改行で並べる', () => {
    expect(
      composeLinkedPost(document(), { limit: 500, hashtags: 3 }),
    ).toBe('はじめての投稿\nhttps://hexx.jp/posts/2026/09/hello-world\n#atproto #standard-site');
  });

  it('タグを付けない指定なら URL まで', () => {
    expect(composeLinkedPost(document(), { limit: 500 })).toBe(
      'はじめての投稿\nhttps://hexx.jp/posts/2026/09/hello-world',
    );
  });

  it('上限を超えるときはタイトルを切り詰め、URL は残す', () => {
    const tail = 'https://hexx.jp/posts/2026/09/hello-world';
    const text = composeLinkedPost(document({ title: 'あ'.repeat(100) }), { limit: 80, hashtags: 2 });
    expect([...text].length).toBe(80);
    expect(text.endsWith(`${tail}\n#atproto #standard-site`)).toBe(true);
  });

  it('タグが入らないときはタグだけ落とす（URL とタイトルを優先）', () => {
    const tail = 'https://hexx.jp/posts/2026/09/hello-world';
    const text = composeLinkedPost(document({ title: 'あ'.repeat(100) }), { limit: 60, hashtags: 2 });
    expect([...text].length).toBe(60);
    expect(text.endsWith(tail)).toBe(true);
    expect(text).not.toContain('#');
  });

  it('極端に短い上限でも URL を落とさない', () => {
    const text = composeLinkedPost(document({ title: 'あ'.repeat(50) }), { limit: 40 });
    expect(text).toContain('https://hexx.jp/posts/2026/09/hello-world');
  });
});

describe('composeNoteText', () => {
  const note = (overrides: Partial<DeliveryDocument> = {}) =>
    document({ kind: 'note', path: '/notes/2026/09/x', slug: 'x', url: 'https://hexx.jp/notes/2026/09/x', ...overrides });

  it('本文をそのまま使う（URL は付けない）', () => {
    expect(composeNoteText(note({ textContent: '短いメモ' }), { limit: 500, hashtags: 1 })).toBe(
      '短いメモ\n#atproto',
    );
  });

  it('本文が無ければタイトルで代替する', () => {
    expect(composeNoteText(note({ textContent: undefined }), { limit: 500 })).toBe('はじめての投稿');
  });

  it('上限で切り詰める', () => {
    const text = composeNoteText(note({ textContent: 'あ'.repeat(100) }), { limit: 20 });
    expect([...text].length).toBe(20);
  });
});

describe('composeSnsText', () => {
  it('Post はリンク付き、Note は本文そのまま', () => {
    expect(composeSnsText(document(), { limit: 500 })).toContain('https://hexx.jp/posts/2026/09/hello-world');
    expect(
      composeSnsText(document({ kind: 'note', textContent: 'メモ' }), { limit: 500 }),
    ).toBe('メモ');
  });
});
