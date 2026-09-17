const segmenter: Intl.Segmenter | null =
  typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function'
    ? new Intl.Segmenter('ja', { granularity: 'grapheme' })
    : null;

/**
 * グラフェム単位の文字数を返す。絵文字や結合文字を1文字として数える。
 * `Intl.Segmenter` が無い環境ではコードポイント数に退化する。
 */
export function graphemeLength(value: string): number {
  if (!value) return 0;
  if (!segmenter) return [...value].length;
  let count = 0;
  for (const _ of segmenter.segment(value)) count += 1;
  return count;
}
