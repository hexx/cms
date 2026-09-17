import type { RunContext } from './context.ts';

/** Discord へ通知する。Webhook が未設定・失敗しても本処理は止めない */
export async function notify(ctx: RunContext, content: string): Promise<void> {
  const url = ctx.env.DISCORD_WEBHOOK_URL;
  if (!url) {
    ctx.log('info', '通知（Discord 未設定）', { content });
    return;
  }
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: content.slice(0, 1900) }),
    });
    if (!response.ok) {
      ctx.log('warn', 'Discord への通知に失敗しました', { status: response.status });
    }
  } catch (error) {
    ctx.log('warn', 'Discord への通知に失敗しました', { error: String(error) });
  }
}
