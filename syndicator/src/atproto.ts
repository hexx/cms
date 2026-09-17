import { AtpAgent, type BlobRef } from '@atproto/api';
import { CONFIG, PDS_HOST, SITE_DESCRIPTION, SITE_NAME, SITE_URL, type Rgb } from '@hexx/shared';
import type { RunContext } from './context.ts';
import { didFromAtUri } from './env.ts';
import type { SnapshotRow } from './types.ts';

const PUBLICATION_COLLECTION = 'site.standard.publication';
const DOCUMENT_COLLECTION = 'site.standard.document';
export const PUBLICATION_RKEY = 'self';

const ALLOWED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
/** PDS の blob 上限（1MB 未満）に余裕を持たせる */
const MAX_IMAGE_BYTES = 950_000;

/** 書き込み先の repo。ログイン済みならセッションの DID、未ログインなら publication の DID を使う */
function repoOf(ctx: RunContext): string {
  return ctx.bsky?.session?.did ?? didFromAtUri(ctx.publicationAtUri);
}

export async function getAgent(ctx: RunContext): Promise<AtpAgent> {
  if (ctx.bsky) return ctx.bsky;
  const handle = ctx.env.BSKY_HANDLE;
  const password = ctx.env.BSKY_APP_PASSWORD;
  if (!handle || !password) {
    throw new Error('BSKY_HANDLE / BSKY_APP_PASSWORD が設定されていません');
  }
  const agent = new AtpAgent({ service: `https://${PDS_HOST}` });
  await agent.login({ identifier: handle, password });
  ctx.bsky = agent;
  return agent;
}

function rgb(value: Rgb) {
  return { $type: 'site.standard.theme.color#rgb', ...value };
}

/** 画像を PDS にアップロードして blob 参照を返す。取得・形式・サイズのどれかで失敗したら undefined */
export async function uploadImage(ctx: RunContext, url: string): Promise<BlobRef | undefined> {
  const response = await fetch(url);
  if (!response.ok) {
    ctx.log('warn', '画像を取得できません', { url, status: response.status });
    return undefined;
  }
  const mime = (response.headers.get('content-type') ?? '').split(';')[0]?.trim() ?? '';
  if (!ALLOWED_IMAGE_TYPES.includes(mime)) {
    ctx.log('warn', '画像の形式が未対応です', { url, mime });
    return undefined;
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_IMAGE_BYTES) {
    ctx.log('warn', '画像のサイズが範囲外です', { url, bytes: bytes.byteLength });
    return undefined;
  }
  const agent = await getAgent(ctx);
  const { data } = await agent.com.atproto.repo.uploadBlob(bytes, { encoding: mime });
  return data.blob;
}

export function buildPublicationRecord(icon?: BlobRef) {
  return {
    $type: PUBLICATION_COLLECTION,
    url: SITE_URL,
    name: SITE_NAME,
    description: SITE_DESCRIPTION,
    ...(icon ? { icon } : {}),
    basicTheme: {
      $type: 'site.standard.theme.basic',
      background: rgb(CONFIG.basicTheme.background),
      foreground: rgb(CONFIG.basicTheme.foreground),
      accent: rgb(CONFIG.basicTheme.accent),
      accentForeground: rgb(CONFIG.basicTheme.accentForeground),
    },
    preferences: { showInDiscover: true },
  };
}

export function buildDocumentRecord(
  snapshot: SnapshotRow,
  options: {
    site: string;
    cover?: BlobRef;
    bskyPostRef?: { uri: string; cid: string };
  },
) {
  const tags = safeTags(snapshot.tags);
  return {
    $type: DOCUMENT_COLLECTION,
    site: options.site,
    path: snapshot.path,
    title: snapshot.title,
    ...(snapshot.description ? { description: snapshot.description } : {}),
    ...(options.cover ? { coverImage: options.cover } : {}),
    ...(snapshot.text_content ? { textContent: snapshot.text_content } : {}),
    ...(tags.length > 0 ? { tags } : {}),
    publishedAt: snapshot.published_at,
    ...(snapshot.updated_at ? { updatedAt: snapshot.updated_at } : {}),
    ...(options.bskyPostRef ? { bskyPostRef: options.bskyPostRef } : {}),
  };
}

function safeTags(json: string): string[] {
  try {
    const parsed: unknown = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.filter((t): t is string => typeof t === 'string') : [];
  } catch {
    return [];
  }
}

export async function putPublicationRecord(
  ctx: RunContext,
): Promise<{ atUri: string; cid: string | null }> {
  const agent = await getAgent(ctx);
  const icon = await uploadImage(ctx, `${SITE_URL}/icon-512.png`);
  const record = buildPublicationRecord(icon);
  const response = await agent.com.atproto.repo.putRecord({
    repo: repoOf(ctx),
    collection: PUBLICATION_COLLECTION,
    rkey: PUBLICATION_RKEY,
    record,
    validate: false,
  });
  return { atUri: response.data.uri, cid: response.data.cid ?? null };
}

/**
 * publication レコードが無ければ作る。`force` なら常に書き直す（管理操作用）。
 * 毎回の run で無駄な blob アップロードをしなため、まず getRecord で存在確認する。
 */
export async function ensurePublication(
  ctx: RunContext,
  force = false,
): Promise<{ existed: boolean; atUri?: string }> {
  const agent = await getAgent(ctx);
  if (!force) {
    try {
      const current = await agent.com.atproto.repo.getRecord({
        repo: repoOf(ctx),
        collection: PUBLICATION_COLLECTION,
        rkey: PUBLICATION_RKEY,
      });
      return { existed: true, atUri: current.data.uri };
    } catch {
      // 未作成。このまま作る
    }
  }
  const created = await putPublicationRecord(ctx);
  return { existed: false, atUri: created.atUri };
}

export async function putDocumentRecord(
  ctx: RunContext,
  snapshot: SnapshotRow,
): Promise<{ rkey: string; atUri: string; cid: string | null }> {
  const agent = await getAgent(ctx);
  const cover = snapshot.cover_image_url
    ? await uploadImage(ctx, snapshot.cover_image_url)
    : undefined;
  const record = buildDocumentRecord(snapshot, { site: ctx.publicationAtUri, cover });
  const response = await agent.com.atproto.repo.putRecord({
    repo: repoOf(ctx),
    collection: DOCUMENT_COLLECTION,
    rkey: snapshot.slug,
    record,
    validate: false,
  });
  return { rkey: snapshot.slug, atUri: response.data.uri, cid: response.data.cid ?? null };
}

/** 既存レコードを読んで bskyPostRef だけ足す（cover などの blob を保つため） */
export async function attachBskyPostRef(
  ctx: RunContext,
  snapshot: SnapshotRow,
  ref: { uri: string; cid: string },
): Promise<void> {
  const agent = await getAgent(ctx);
  const repo = repoOf(ctx);
  const current = await agent.com.atproto.repo.getRecord({
    repo,
    collection: DOCUMENT_COLLECTION,
    rkey: snapshot.slug,
  });
  const record = {
    ...(current.data.value as Record<string, unknown>),
    bskyPostRef: { uri: ref.uri, cid: ref.cid },
  };
  await agent.com.atproto.repo.putRecord({
    repo,
    collection: DOCUMENT_COLLECTION,
    rkey: snapshot.slug,
    record,
    validate: false,
  });
}

export async function deleteRecordAtUri(ctx: RunContext, atUri: string): Promise<void> {
  const parsed = parseAtUri(atUri);
  if (!parsed) throw new Error(`AT-URI を解釈できません: ${atUri}`);
  const agent = await getAgent(ctx);
  await agent.com.atproto.repo.deleteRecord({
    repo: repoOf(ctx) || parsed.did,
    collection: parsed.collection,
    rkey: parsed.rkey,
  });
}

export function parseAtUri(
  atUri: string,
): { did: string; collection: string; rkey: string } | null {
  const match = /^at:\/\/([^/]+)\/([^/]+)\/([^/]+)$/.exec(atUri);
  if (!match) return null;
  const [, did, collection, rkey] = match;
  if (!did || !collection || !rkey) return null;
  return { did, collection, rkey };
}
