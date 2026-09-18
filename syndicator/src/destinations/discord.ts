import { CONFIG } from '@hexx/shared';
import type { Env } from '../env.ts';
import type { Destination, PublishOutcome } from './types.ts';

/** Discord の embed の上限（description は 4096 だが、長くても読まれないので短くする） */
const MAX_DESCRIPTION = 300;

function webhookUrl(env: Env): string {
  return (env.DISCORD_WEBHOOK_URL ?? '').replace(/\/+$/, '');
}

/** `?wait=true` を付けると作成されたメッセージが返り、削除に使う id が取れる */
function withWait(url: string): string {
  return `${url}${url.includes('?') ? '&' : '?'}wait=true`;
}

export function accentColor(): number {
  const { r, g, b } = CONFIG.basicTheme.accent;
  return (r << 16) + (g << 8) + b;
}

export const discord: Destination = {
  id: 'discord',
  label: 'Discord',

  isConfigured(env: Env): boolean {
    return Boolean(env.DISCORD_WEBHOOK_URL);
  },

  async publish(ctx, doc): Promise<PublishOutcome> {
    const description = (doc.description ?? doc.textContent ?? '').replace(/\s+/g, ' ').trim();
    const body = {
      username: CONFIG.name,
      embeds: [
        {
          title: doc.title,
          ...(description ? { description: description.slice(0, MAX_DESCRIPTION) } : {}),
          url: doc.url,
          color: accentColor(),
          ...(doc.coverImageUrl ? { thumbnail: { url: doc.coverImageUrl } } : {}),
          timestamp: doc.publishedAt,
          footer: { text: doc.kind === 'post' ? 'Post' : 'Note' },
        },
      ],
    };
    const request = { url: withWait(webhookUrl(ctx.env)), body };

    if (ctx.dryRun) {
      return { externalUri: `dry-run:discord:${doc.path}`, request };
    }

    const response = await fetch(request.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`Discord への投稿に失敗: ${response.status} ${detail.slice(0, 200)}`);
    }

    const created = (await response.json()) as { id?: string };
    if (!created.id) throw new Error('Discord の応答にメッセージ id がありません');
    return {
      externalUri: doc.url,
      externalId: created.id,
      request,
    };
  },

  async remove(ctx, delivery): Promise<void> {
    const id = delivery.external_id;
    if (!id) return;
    const url = `${webhookUrl(ctx.env)}/messages/${id}`;
    if (ctx.dryRun) {
      ctx.log('info', '[dry-run] Discord のメッセージを削除します', { url });
      return;
    }
    const response = await fetch(url, { method: 'DELETE' });
    // すでに消えている場合は成功として扱う
    if (!response.ok && response.status !== 404) {
      throw new Error(`Discord のメッセージを削除できません: ${response.status}`);
    }
  },
};
