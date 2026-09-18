import { SITE_URL, hexxJsonFeedSchema, type HexxJsonFeed } from '@hexx/shared';
import type { RunContext } from './context.ts';
import { feedUrl } from './env.ts';

const FEED_TIMEOUT_MS = 15_000;

/** 公開フィード（`/feed-all.json`）を取得して検証する */
export async function fetchFeed(ctx: RunContext): Promise<HexxJsonFeed> {
  const base = feedUrl(ctx.env);
  const url = `${base}${base.includes('?') ? '&' : '?'}v=${ctx.now.getTime()}`;

  const response = await fetch(url, {
    headers: { Accept: 'application/json' },
    // 応答が無いまま Worker の実行時間を食い潰さない
    signal: AbortSignal.timeout(FEED_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`フィードを取得できません: ${response.status} ${response.statusText} (${url})`);
  }

  const json: unknown = await response.json();
  const parsed = hexxJsonFeedSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error(`フィードの形が想定と違います: ${parsed.error.issues[0]?.message ?? 'unknown'}`);
  }
  if (parsed.data.home_page_url !== SITE_URL) {
    throw new Error(
      `フィードの home_page_url が想定と違います: ${parsed.data.home_page_url} (期待 ${SITE_URL})`,
    );
  }
  return parsed.data;
}
