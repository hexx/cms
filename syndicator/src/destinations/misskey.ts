import type { RunContext } from '../context.ts';
import { misskeyInstanceUrl } from '../env.ts';
import { composeSnsText } from '../text.ts';
import type { Destination, PublishOutcome } from './types.ts';

/** Misskey の既定上限は 3000 字。タグを足しても収まるが、念のため切る */
const MAX_CHARS = 3000;
const MAX_HASHTAGS = 3;

type MisskeyResponse<T> = T & { error?: { message?: string; code?: string } };

export const misskey: Destination = {
  id: 'misskey',
  label: 'Misskey',

  async isConfigured(ctx): Promise<boolean> {
    // インスタンス URL には既定値（misskey.io）があるのでトークンだけで判定する
    return Boolean(ctx.env.MISSKEY_TOKEN);
  },

  async publish(ctx, doc): Promise<PublishOutcome> {
    const base = misskeyInstanceUrl(ctx.env);
    const body = {
      // Misskey は伝統的にトークンを本文の i で受け取る。
      // 新しい実装は Authorization ヘッダーも見るので、両方送ってどの版でも通るようにする。
      i: ctx.env.MISSKEY_TOKEN,
      visibility: 'public' as const,
      text: composeSnsText(doc, { limit: MAX_CHARS, hashtags: MAX_HASHTAGS }),
    };
    const request = { url: `${base}/api/notes/create`, body };

    if (ctx.dryRun) {
      return { externalUri: `dry-run:misskey:${doc.path}`, request };
    }

    const response = await fetch(request.url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ctx.env.MISSKEY_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`Misskey への投稿に失敗: ${response.status} ${await response.text()}`);
    }

    // Misskey はエラーでも 200 を返し、本文に error を入れてくることがある
    const json = (await response.json()) as MisskeyResponse<{ createdNote?: { id?: string } }>;
    if (json.error) {
      throw new Error(`Misskey への投稿に失敗: ${json.error.message ?? json.error.code ?? 'unknown'}`);
    }
    const id = json.createdNote?.id;
    if (!id) {
      throw new Error('Misskey の応答に createdNote.id がありません');
    }

    return {
      externalUri: `${base}/notes/${id}`,
      externalId: id,
      request,
    };
  },

  async remove(ctx: RunContext, delivery): Promise<void> {
    const id = delivery.external_id;
    if (!id) return;
    const url = `${misskeyInstanceUrl(ctx.env)}/api/notes/delete`;
    if (ctx.dryRun) {
      ctx.log('info', '[dry-run] Misskey のノートを削除します', { noteId: id });
      return;
    }
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ctx.env.MISSKEY_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ i: ctx.env.MISSKEY_TOKEN, noteId: id }),
    });
    if (!response.ok) {
      throw new Error(`Misskey のノートを削除できません: ${response.status}`);
    }
    const json = (await response.json()) as MisskeyResponse<Record<string, unknown>>;
    // すでに消えている（NO_SUCH_NOTE）場合は成功として扱う
    if (json.error && json.error.code !== 'NO_SUCH_NOTE') {
      throw new Error(`Misskey のノートを削除できません: ${json.error.message ?? json.error.code}`);
    }
  },
};
