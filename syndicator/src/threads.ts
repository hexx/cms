import type { RunContext } from './context.ts';
import { getCredential, putCredential } from './db.ts';
import type { Env } from './env.ts';

const CREDENTIAL_NAME = 'threads';
const GRAPH = 'https://graph.threads.net/v1.0';
const REFRESH_ENDPOINT = 'https://graph.threads.net/refresh_access_token';
/** これより古ければ更新する（Meta は 24 時間以上経った長期トークンの更新を許す） */
const REFRESH_AFTER_MS = 20 * 60 * 60 * 1000;

export type ThreadsCredential = {
  userId: string;
  accessToken: string;
};

/** D1 に保存された Threads の資格情報を読む */
export async function getThreadsCredential(ctx: RunContext): Promise<ThreadsCredential | null> {
  const row = await getCredential(ctx.env.DB, CREDENTIAL_NAME);
  if (!row) return null;
  try {
    const parsed = JSON.parse(row.value) as Partial<ThreadsCredential>;
    if (!parsed.accessToken) return null;
    return { userId: parsed.userId ?? ctx.env.THREADS_USER_ID ?? '', accessToken: parsed.accessToken };
  } catch {
    return null;
  }
}

/** 資格情報を D1 に保存する（初回設定・更新の両方で使う） */
export async function setThreadsCredential(
  ctx: RunContext,
  credential: ThreadsCredential,
  expiresAt: string | null,
): Promise<void> {
  await putCredential(
    ctx.env.DB,
    CREDENTIAL_NAME,
    JSON.stringify(credential),
    ctx.now.toISOString(),
    expiresAt,
  );
}

/** 長期トークンを更新する。成功したら新しい資格情報を返して D1 に保存する */
export async function refreshThreadsToken(ctx: RunContext): Promise<ThreadsCredential> {
  const current = await getThreadsCredential(ctx);
  if (!current) throw new Error('Threads の資格情報が未設定です');

  const response = await fetch(
    `${REFRESH_ENDPOINT}?grant_type=th_refresh_token&access_token=${encodeURIComponent(current.accessToken)}`,
  );
  if (!response.ok) {
    throw new Error(`Threads のトークンを更新できません: ${response.status} ${await response.text()}`);
  }
  const json = (await response.json()) as { access_token?: string; expires_in?: number };
  if (!json.access_token) throw new Error('Threads のトークン更新応答に access_token がありません');

  const next: ThreadsCredential = { userId: current.userId, accessToken: json.access_token };
  const expiresAt =
    typeof json.expires_in === 'number'
      ? new Date(ctx.now.getTime() + json.expires_in * 1000).toISOString()
      : null;
  await setThreadsCredential(ctx, next, expiresAt);
  ctx.log('info', 'Threads のトークンを更新しました', { expiresAt });
  return next;
}

export type RefreshOutcome = 'skipped' | 'refreshed' | 'failed';

/**
 * 必要ならトークンを更新する。run のたびに呼ばれる。
 * 失敗しても run 自体は続ける（配信時に改めて失敗し、Discord へ通知される）。
 */
export async function refreshThreadsTokenIfNeeded(ctx: RunContext): Promise<RefreshOutcome> {
  if (!ctx.env.THREADS_USER_ID && !(await getThreadsCredential(ctx))) return 'skipped';
  if (ctx.dryRun) return 'skipped';

  const row = await getCredential(ctx.env.DB, CREDENTIAL_NAME);
  if (!row) return 'skipped';
  const age = ctx.now.getTime() - new Date(row.updated_at).getTime();
  if (age < REFRESH_AFTER_MS) return 'skipped';

  try {
    await refreshThreadsToken(ctx);
    return 'refreshed';
  } catch (error) {
    ctx.log('warn', 'Threads のトークン更新に失敗しました', { error: String(error) });
    return 'failed';
  }
}

export async function createThreadContainer(
  credential: ThreadsCredential,
  text: string,
): Promise<string> {
  const response = await fetch(`${GRAPH}/${credential.userId}/threads`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ media_type: 'TEXT', text, access_token: credential.accessToken }),
  });
  if (!response.ok) {
    throw new Error(`Threads のコンテナ作成に失敗: ${response.status} ${await response.text()}`);
  }
  const json = (await response.json()) as { id?: string };
  if (!json.id) throw new Error('Threads のコンテナ作成応答に id がありません');
  return json.id;
}

export async function publishThreadContainer(
  credential: ThreadsCredential,
  creationId: string,
): Promise<string> {
  const response = await fetch(`${GRAPH}/${credential.userId}/threads_publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ creation_id: creationId, access_token: credential.accessToken }),
  });
  if (!response.ok) {
    throw new Error(`Threads への公開に失敗: ${response.status} ${await response.text()}`);
  }
  const json = (await response.json()) as { id?: string };
  if (!json.id) throw new Error('Threads の公開応答に id がありません');
  return json.id;
}

/** 投稿の permalink を取る（取れなくても致命ではない） */
export async function fetchThreadPermalink(
  credential: ThreadsCredential,
  threadId: string,
): Promise<string | undefined> {
  const response = await fetch(
    `${GRAPH}/${threadId}?fields=permalink&access_token=${encodeURIComponent(credential.accessToken)}`,
  );
  if (!response.ok) return undefined;
  const json = (await response.json()) as { permalink?: string };
  return json.permalink;
}

export async function deleteThread(credential: ThreadsCredential, threadId: string): Promise<void> {
  const response = await fetch(
    `${GRAPH}/${threadId}?access_token=${encodeURIComponent(credential.accessToken)}`,
    { method: 'DELETE' },
  );
  // すでに消えている場合は成功として扱う
  if (!response.ok && response.status !== 404) {
    throw new Error(`Threads の投稿を削除できません: ${response.status} ${await response.text()}`);
  }
}

export function threadsConfigured(env: Env): boolean {
  return Boolean(env.THREADS_USER_ID);
}
