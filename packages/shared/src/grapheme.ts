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

/** グラフェム単位で切り詰める。上限以内ならそのまま返す */
export function truncateGraphemes(value: string, max: number): string {
  if (graphemeLength(value) <= max) return value;
  // Segmenter が無い環境でもサロゲートペアを割らないようコードポイント単位で切る
  if (!segmenter) return [...value].slice(0, max).join('');
  let result = '';
  let count = 0;
  for (const { segment } of segmenter.segment(value)) {
    if (count + 1 > max) break;
    result += segment;
    count += 1;
  }
  return result;
}
