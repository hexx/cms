import { truncateGraphemes } from '@hexx/shared';
import { getAgent, parseAtUri, uploadImage } from '../atproto.ts';
import type { RunContext } from '../context.ts';
import { didFromAtUri } from '../env.ts';
import type { DeliveryDocument } from '../types.ts';
import type { Destination, PublishOutcome } from './types.ts';

const POST_COLLECTION = 'app.bsky.feed.post';
const EMBED_DESCRIPTION_MAX = 300;

function repoOf(ctx: RunContext): string {
  return ctx.bsky?.session?.did ?? didFromAtUri(ctx.publicationAtUri);
}

/** `app.bsky.embed.external` を組み立てる。カードを確実に出すために明示的に付ける */
async function buildEmbed(ctx: RunContext, doc: DeliveryDocument, withThumb: boolean) {
  const rawDescription = doc.description ?? doc.textContent?.replace(/\n+/g, ' ') ?? '';
  const description = truncateGraphemes(rawDescription, EMBED_DESCRIPTION_MAX);

  const thumb =
    withThumb && doc.coverImageUrl && !ctx.dryRun
      ? await uploadImage(ctx, doc.coverImageUrl).catch(() => undefined)
      : undefined;

  return {
    $type: 'app.bsky.embed.external',
    external: {
      uri: doc.url,
      title: doc.title,
      description,
      ...(thumb ? { thumb } : {}),
    },
  };
}

export const bluesky: Destination = {
  id: 'bluesky',
  label: 'Bluesky',

  async isConfigured(ctx): Promise<boolean> {
    return Boolean(ctx.env.BSKY_HANDLE && ctx.env.BSKY_APP_PASSWORD);
  },

  async publish(ctx, doc): Promise<PublishOutcome> {
    const embed = await buildEmbed(ctx, doc, true);
    const record = {
      $type: POST_COLLECTION,
      text: truncateGraphemes(doc.title, 300),
      createdAt: ctx.now.toISOString(),
      langs: ['ja'],
      embed,
    };

    if (ctx.dryRun) {
      return { externalUri: `dry-run:bluesky:${doc.path}`, request: record };
    }

    const agent = await getAgent(ctx);
    const response = await agent.com.atproto.repo.createRecord({
      repo: repoOf(ctx),
      collection: POST_COLLECTION,
      record,
    });
    const uri = response.data.uri;
    const cid = response.data.cid;
    return {
      externalUri: uri,
      externalId: uri,
      recordRef: { uri, cid },
      request: record,
    };
  },

  async remove(ctx, delivery): Promise<void> {
    const uri = delivery.external_uri;
    if (!uri) return;
    if (ctx.dryRun) {
      ctx.log('info', '[dry-run] Bluesky の投稿を削除します', { uri });
      return;
    }
    const parsed = parseAtUri(uri);
    if (!parsed) throw new Error(`Bluesky の投稿 URI を解釈できません: ${uri}`);
    const agent = await getAgent(ctx);
    await agent.com.atproto.repo.deleteRecord({
      repo: repoOf(ctx),
      collection: parsed.collection,
      rkey: parsed.rkey,
    });
  },
};
