import type { RunContext } from '../context.ts';
import type { Env } from '../env.ts';
import { mastodonInstanceUrl } from '../env.ts';
import { composeSnsText } from '../text.ts';
import type { Destination, PublishOutcome } from './types.ts';

/** 多くのインスタンスの既定上限。インスタンス依存だが、超えると弾かれる方が困るので余裕を見る */
const MAX_CHARS = 500;
/** ハッシュタグは付けすぎない */
const MAX_HASHTAGS = 3;

export const mastodon: Destination = {
  id: 'mastodon',
  label: 'Mastodon',

  isConfigured(env: Env): boolean {
    return Boolean(env.MASTODON_INSTANCE_URL && env.MASTODON_TOKEN);
  },

  async publish(ctx, doc): Promise<PublishOutcome> {
    const base = mastodonInstanceUrl(ctx.env);
    const body = {
      status: composeSnsText(doc, { limit: MAX_CHARS, hashtags: MAX_HASHTAGS }),
      language: 'ja',
      visibility: 'public' as const,
    };
    const request = { url: `${base}/api/v1/statuses`, body };

    if (ctx.dryRun) {
      return { externalUri: `dry-run:mastodon:${doc.path}`, request };
    }

    const response = await fetch(request.url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ctx.env.MASTODON_TOKEN}`,
        'Content-Type': 'application/json',
        // タイムアウト後にサーバ側だけ成功していた場合の二重投稿を防ぐ
        'Idempotency-Key': `hexx:${doc.path}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`Mastodon への投稿に失敗: ${response.status} ${await response.text()}`);
    }

    const created = (await response.json()) as { id?: string; url?: string; uri?: string };
    return {
      externalUri: created.url ?? created.uri ?? `${base}/@me`,
      ...(created.id ? { externalId: created.id } : {}),
      request,
    };
  },

  async remove(ctx: RunContext, delivery): Promise<void> {
    const id = delivery.external_id;
    if (!id) return;
    const url = `${mastodonInstanceUrl(ctx.env)}/api/v1/statuses/${id}`;
    if (ctx.dryRun) {
      ctx.log('info', '[dry-run] Mastodon の投稿を削除します', { url });
      return;
    }
    const response = await fetch(url, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${ctx.env.MASTODON_TOKEN}` },
    });
    // すでに消えている場合は成功として扱う
    if (!response.ok && response.status !== 404 && response.status !== 410) {
      throw new Error(`Mastodon の投稿を削除できません: ${response.status}`);
    }
  },
};
