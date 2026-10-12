import { jstParts } from '@hexx/shared';

/**
 * 一覧の行に出す短い日付（JST）。
 * 年は見出しで示すため含めない。例: `10.12(月)`
 */
export function formatListDate(date: Date): string {
  const { month, day } = jstParts(date);
  const weekday = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    weekday: 'short',
  })
    .format(date)
    .replace('曜', '');
  return `${Number(month)}.${Number(day)}(${weekday})`;
}
