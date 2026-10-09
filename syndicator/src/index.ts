import { Hono, type Context } from 'hono';
import { renderAdmin } from './admin.ts';
import { putPublicationRecord } from './atproto.ts';
import { runBackfill } from './backfill.ts';
import { createContext } from './context.ts';
import { verifyAccessToken } from './access.ts';
import { setThreadsCredential } from './threads.ts';
import {
  getDelivery,
  listDeliveries,
  listRunLogs,
  listSnapshots,
  requeueDelivery,
} from './db.ts';
import { processDelivery, processDueDeliveries } from './delivery.ts';
import {
  enabledDestinations,
  isDryRun,
  isPlaceholderAtUri,
  publicationAtUri,
  type Env,
} from './env.ts';
import { runAndRecord, unpublishDocument } from './run.ts';

const app = new Hono<{ Bindings: Env }>();

/** 長さ一定の比較（共有シークレットの比較用） */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

app.get('/health', (c) =>
  c.json({
    ok: true,
    dryRun: isDryRun(c.env),
    placeholderPublication: isPlaceholderAtUri(publicationAtUri(c.env)),
    destinations: enabledDestinations(c.env),
  }),
);

/** デプロイフック / 外部トリガー。共有シークレットで保護する */
app.post('/syndicate', async (c) => {
  const secret = c.env.SYNDICATE_SECRET;
  const provided = c.req.header('x-syndicate-secret') ?? '';
  if (!secret || !timingSafeEqual(secret, provided)) {
    return c.json({ error: 'unauthorized' }, 401);
  }

  const context = createContext(c.env, c.req.header('x-syndicate-trigger') ?? 'deploy-hook');

  try {
    // 実行ロックは runAndRecord の中で取る（Cron と重なったら片方が locked で戻る）
    const result = await runAndRecord(context);
    return c.json(result, 'skipped' in result ? 202 : 200);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});

/** 読み取り・管理 API。Bearer トークンで保護する */
app.use('/v1/*', async (c, next) => {
  const token = c.env.ADMIN_TOKEN;
  const header = c.req.header('authorization') ?? '';
  const provided = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token || !timingSafeEqual(token, provided)) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  await next();
});

app.get('/v1/deliveries', async (c) => {
  const limit = Math.min(Number(c.req.query('limit') ?? 100) || 100, 500);
  const status = c.req.query('status');
  const rows = await listDeliveries(c.env.DB, {
    limit,
    ...(status ? { status: status as never } : {}),
    ...(c.req.query('path') ? { path: c.req.query('path') as string } : {}),
  });
  return c.json({ deliveries: rows });
});

app.post('/v1/deliveries/:id/retry', async (c) => {
  const id = Number(c.req.param('id'));
  const row = await getDelivery(c.env.DB, id);
  if (!row) return c.json({ error: 'not found' }, 404);
  const context = createContext(c.env, 'manual-retry');
  await requeueDelivery(c.env.DB, id, context.now.toISOString());
  // 期日処理と同じ経路を通す（未公開・資格情報なし・失敗時の再試行まで同じ扱い）
  const outcome = await processDelivery(context, { ...row, status: 'pending', attempt: 0 });
  return c.json({ outcome, delivery: await getDelivery(c.env.DB, id) });
});

app.get('/v1/runs', async (c) => c.json({ runs: await listRunLogs(c.env.DB, 50) }));

/**
 * 手動で非公開にする。
 *
 * フィードが空のときは安全装置（壊れたデプロイで全記事を消さないため）が
 * 削除を見送るので、意図的な削除の出口としてこれを使う。
 *   { "all": true }                  → 公開中のものを全部
 *   { "paths": ["/posts/..."] }      → 指定したものだけ
 */
app.post('/v1/unpublish', async (c) => {
  const body = (await c.req.json().catch(() => null)) as
    | { paths?: string[]; all?: boolean }
    | null;
  if (!body?.all && !body?.paths?.length) {
    return c.json({ error: 'paths か all が必要です' }, 400);
  }

  const context = createContext(c.env, 'manual-unpublish');
  if (context.dryRun) {
    return c.json({ error: 'DRY_RUN が有効な間は実行できません' }, 409);
  }

  const snapshots = await listSnapshots(c.env.DB);
  const live = snapshots.filter((snapshot) => !snapshot.unpublished_at);
  const targets = body.all
    ? live
    : live.filter((snapshot) => body.paths?.includes(snapshot.path) ?? false);

  for (const snapshot of targets) {
    await unpublishDocument(context, snapshot.path);
  }
  // 予約した削除（レコード・SNS 投稿）をその場で処理する
  const deliveries = targets.length > 0 ? await processDueDeliveries(context, 100) : null;

  return c.json({
    unpublished: targets.length,
    paths: targets.map((snapshot) => snapshot.path),
    ...(deliveries ? { deliveries } : {}),
  });
});

/**
 * 公開済み Document を後から追加した Destination へ流す。
 * `force: true` は送信済みも含めてやり直す（削除後の復活など、明示的な操作に限る）。
 */
app.post('/v1/backfill', async (c) => {
  const body = (await c.req.json().catch(() => null)) as {
    destination?: string;
    since?: string;
    force?: boolean;
  } | null;
  if (!body?.destination) return c.json({ error: 'destination は必須です' }, 400);

  const context = createContext(c.env, 'backfill');
  try {
    const result = await runBackfill(context, {
      destination: body.destination as never,
      ...(body.since ? { since: body.since } : {}),
      ...(body.force ? { force: true } : {}),
    });
    return c.json(result);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
  }
});

/** Threads の長期トークンを登録する（初回は Meta 側で発行した値を渡す） */
app.post('/v1/credentials/threads', async (c) => {
  const body = (await c.req.json().catch(() => null)) as
    | { userId?: string; accessToken?: string; expiresIn?: number }
    | null;
  if (!body?.accessToken) return c.json({ error: 'accessToken は必須です' }, 400);

  const context = createContext(c.env, 'credential-set');
  const userId = body.userId ?? c.env.THREADS_USER_ID ?? '';
  if (!userId) return c.json({ error: 'userId は必須です（THREADS_USER_ID でも可）' }, 400);

  // 不正な期限（0・負・NaN・過大）を保存しない
  const MAX_EXPIRES_IN_SECONDS = 90 * 24 * 60 * 60;
  if (
    body.expiresIn !== undefined &&
    (!Number.isFinite(body.expiresIn) || body.expiresIn <= 0 || body.expiresIn > MAX_EXPIRES_IN_SECONDS)
  ) {
    return c.json({ error: 'expiresIn は 1〜7776000 秒の範囲で指定してください' }, 400);
  }
  const expiresAt =
    typeof body.expiresIn === 'number'
      ? new Date(context.now.getTime() + body.expiresIn * 1000).toISOString()
      : null;
  await setThreadsCredential(context, { userId, accessToken: body.accessToken }, expiresAt);
  return c.json({ userId, expiresAt });
});

app.post('/v1/publication', async (c) => {
  const context = createContext(c.env, 'publication-sync');
  try {
    const result = await putPublicationRecord(context);
    return c.json(result);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});

/**
 * 管理画面。Cloudflare Access のアプリケーションを `/admin*` に張る前提で、
 * ここでは追加の認証をしない（外部からは Access が門番になる）。
 */
/**
 * 管理画面を開いてよいか。
 *
 * - `ADMIN_ALLOW_DIRECT=true`（ローカル検証用）
 * - Bearer トークン（スクリプト用）
 * - Cloudflare Access の JWT（**署名・aud・期限を検証する**）
 *
 * ヘッダーの有無だけを見ると、誰でも同じ名前のヘッダーを付けて通れてしまうので、
 * Access 経由かどうかは必ず署名で確かめる。
 */
async function isAdminRequest(c: Context<{ Bindings: Env }>): Promise<boolean> {
  if (c.env.ADMIN_ALLOW_DIRECT === 'true') return true;

  const token = c.env.ADMIN_TOKEN;
  const provided = (c.req.header('authorization') ?? '').replace(/^Bearer /, '');
  if (token && provided && timingSafeEqual(token, provided)) return true;

  const teamDomain = c.env.ACCESS_TEAM_DOMAIN;
  const aud = c.env.ACCESS_AUD;
  const assertion = c.req.header('cf-access-jwt-assertion');
  if (!teamDomain || !aud || !assertion) return false;

  const result = await verifyAccessToken(assertion, { teamDomain, aud });
  if (!result.ok) {
    console.warn(
      JSON.stringify({
        level: 'warn',
        msg: 'Access の JWT を検証できませんでした',
        reason: result.reason,
      }),
    );
    return false;
  }
  return true;
}

app.get('/admin', async (c) => {
  if (!(await isAdminRequest(c))) {
    return c.text(
      'この画面は Cloudflare Access で保護してください（syndicator.hexx.jp/admin* にアプリを作成し、' +
        'ACCESS_TEAM_DOMAIN と ACCESS_AUD を設定する）。\n' +
        'スクリプトから叩く場合は Authorization: Bearer <ADMIN_TOKEN> を付けてください。',
      403,
    );
  }
  const html = await renderAdmin(c.env);
  return c.html(html);
});

app.post('/admin/deliveries/:id/retry', async (c) => {
  if (!(await isAdminRequest(c))) return c.text('forbidden', 403);
  const id = Number(c.req.param('id'));
  const row = await getDelivery(c.env.DB, id);
  if (row) {
    const context = createContext(c.env, 'admin-retry');
    await requeueDelivery(c.env.DB, id, context.now.toISOString());
    try {
      await processDelivery(context, { ...row, status: 'pending', attempt: 0 });
    } catch (error) {
      context.log('error', '手動再送に失敗しました', { id, error: String(error) });
    }
  }
  return c.redirect('/admin', 303);
});

export { app };

export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    const context = createContext(env, 'cron');
    ctx.waitUntil(
      runAndRecord(context).catch((error) => {
        context.log('error', 'cron の実行に失敗しました', { error: String(error) });
      }),
    );
  },
};
