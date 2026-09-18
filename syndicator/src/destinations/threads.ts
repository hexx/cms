import type { RunContext } from '../context.ts';
import { composeSnsText } from '../text.ts';
import {
  createThreadContainer,
  deleteThread,
  fetchThreadPermalink,
  getThreadsCredential,
  publishThreadContainer,
  threadsConfigured,
} from '../threads.ts';
import type { Destination, PublishOutcome } from './types.ts';

/** Threads の本文上限 */
const MAX_CHARS = 500;

export const threads: Destination = {
  id: 'threads',
  label: 'Threads',

  isConfigured(env): boolean {
    return threadsConfigured(env);
  },

  async publish(ctx, doc): Promise<PublishOutcome> {
    const text = composeSnsText(doc, { limit: MAX_CHARS });
    const credential = await getThreadsCredential(ctx);
    const request = { text, userId: credential?.userId ?? ctx.env.THREADS_USER_ID ?? null };

    if (ctx.dryRun) {
      return { externalUri: `dry-run:threads:${doc.path}`, request };
    }
    if (!credential?.accessToken) {
      throw new Error(
        'Threads のアクセストークンがありません。`POST /v1/credentials/threads` で設定してください',
      );
    }

    // Threads は「コンテナ作成 → publish」の2段階
    const creationId = await createThreadContainer(credential, text);
    const threadId = await publishThreadContainer(credential, creationId);
    const permalink = await fetchThreadPermalink(credential, threadId).catch(() => undefined);

    return {
      externalUri: permalink ?? `https://www.threads.net/t/${threadId}`,
      externalId: threadId,
      request,
    };
  },

  async remove(ctx: RunContext, delivery): Promise<void> {
    const id = delivery.external_id;
    if (!id) return;
    if (ctx.dryRun) {
      ctx.log('info', '[dry-run] Threads の投稿を削除します', { id });
      return;
    }
    const credential = await getThreadsCredential(ctx);
    if (!credential?.accessToken) throw new Error('Threads のアクセストークンがありません');
    await deleteThread(credential, id);
  },
};
