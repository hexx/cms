import { Hono } from 'hono';
import { renderAdmin } from './admin.ts';
import { putPublicationRecord } from './atproto.ts';
import { createContext } from './context.ts';
import { setThreadsCredential } from './threads.ts';
import { getDelivery, listDeliveries, listRunLogs, requeueDelivery } from './db.ts';
import { processOneDelivery } from './delivery.ts';
import {
  enabledDestinations,
  isDryRun,
  isPlaceholderAtUri,
  publicationAtUri,
  type Env,
} from './env.ts';
import { runAndRecord } from './run.ts';

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
    const summary = await runAndRecord(context);
    return c.json(summary);
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
  try {
    await processOneDelivery(context, { ...row, status: 'pending', attempt: 0 });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
  return c.json({ delivery: await getDelivery(c.env.DB, id) });
});

app.get('/v1/runs', async (c) => c.json({ runs: await listRunLogs(c.env.DB, 50) }));

/** Threads の長期トークンを登録する（初回は Meta 側で発行した値を渡す） */
app.post('/v1/credentials/threads', async (c) => {
  const body = (await c.req.json().catch(() => null)) as
    | { userId?: string; accessToken?: string; expiresIn?: number }
    | null;
  if (!body?.accessToken) return c.json({ error: 'accessToken は必須です' }, 400);

  const context = createContext(c.env, 'credential-set');
  const userId = body.userId ?? c.env.THREADS_USER_ID ?? '';
  if (!userId) return c.json({ error: 'userId は必須です（THREADS_USER_ID でも可）' }, 400);

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
app.get('/admin', async (c) => {
  const html = await renderAdmin(c.env);
  return c.html(html);
});

app.post('/admin/deliveries/:id/retry', async (c) => {
  const id = Number(c.req.param('id'));
  const row = await getDelivery(c.env.DB, id);
  if (row) {
    const context = createContext(c.env, 'admin-retry');
    await requeueDelivery(c.env.DB, id, context.now.toISOString());
    try {
      await processOneDelivery(context, { ...row, status: 'pending', attempt: 0 });
    } catch (error) {
      context.log('error', '手動再送に失敗しました', { id, error: String(error) });
    }
  }
  return c.redirect('/admin', 303);
});

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
