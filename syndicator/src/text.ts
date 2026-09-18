import { graphemeLength, truncateGraphemes } from '@hexx/shared';
import type { DeliveryDocument } from './types.ts';

/** ハッシュタグとして使える形に整える。使える文字が残らなければ null */
export function toHashtag(tag: string): string | null {
  const cleaned = tag
    .trim()
    .replace(/^#+/, '')
    .replace(/\s+/g, '')
    .replace(/[^\p{L}\p{N}_-]/gu, '');
  return cleaned.length > 0 ? cleaned : null;
}

/** `#a #b` の形にする。最大 `max` 個。無ければ空文字 */
export function hashtagSuffix(tags: string[], max: number): string {
  const hashtags = tags
    .map(toHashtag)
    .filter((tag): tag is string => tag !== null)
    .slice(0, max);
  return hashtags.map((tag) => `#${tag}`).join(' ');
}

export type TextOptions = {
  /** 全文の上限（グラフェム） */
  limit: number;
  /** 付けるハッシュタグの最大数。0 なら付けない */
  hashtags?: number;
};

/**
 * Post（長文）用: `タイトル\nURL` にハッシュタグを添える。
 *
 * 優先順位は URL > タイトル > ハッシュタグ。
 * 上限に収まるようまずタイトルを切り詰め、それでも収まらないときはタグを落とす。
 * URL は絶対に落とさないので、URL 単体が上限を超える場合だけ上限を超える。
 */
export function composeLinkedPost(doc: DeliveryDocument, options: TextOptions): string {
  const suffix = options.hashtags ? hashtagSuffix(doc.tags, options.hashtags) : '';
  const url = doc.url;
  // タイトルを入れる余地が無いなら URL だけ返す（上限を守る方を優先する）
  if (options.limit <= graphemeLength(url)) return url;
  const withTags = [url, suffix].filter(Boolean).join('\n');
  const tail = options.limit - graphemeLength(withTags) - 1 >= 1 ? withTags : url;
  const budget = Math.max(options.limit - graphemeLength(tail) - 1, 1);
  const title = truncateGraphemes(doc.title.trim(), budget);
  return `${title}\n${tail}`;
}

/**
 * Note（短文）用: 本文をそのまま流す。
 * 本文が空ならタイトルで代替する。URL は付けない（本文が内容そのものだから）。
 * 上限に収まらないときはタグを落とし、それでも収まらなければ本文を切り詰める。
 */
export function composeNoteText(doc: DeliveryDocument, options: TextOptions): string {
  const suffix = options.hashtags ? hashtagSuffix(doc.tags, options.hashtags) : '';
  const body = (doc.textContent?.trim() || doc.title).trim();
  if (graphemeLength(body) >= options.limit) return truncateGraphemes(body, options.limit);
  const withSuffix = suffix ? `${body}\n${suffix}` : body;
  return graphemeLength(withSuffix) <= options.limit ? withSuffix : body;
}

/** Post / Note の種別に応じて文面を組み立てる */
export function composeSnsText(doc: DeliveryDocument, options: TextOptions): string {
  return doc.kind === 'note' ? composeNoteText(doc, options) : composeLinkedPost(doc, options);
}
