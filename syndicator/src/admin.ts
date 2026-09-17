import { listDeliveries, listRunLogs } from './db.ts';
import type { Env } from './env.ts';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const STATUS_LABELS: Record<string, string> = {
  pending: '待機',
  sending: '送信中',
  sent: '完了',
  dead: '失敗',
  skipped: '見送り',
  deleted: '取消済',
};

/**
 * Cloudflare Access で保護された管理画面。Bearer トークンは使わない
 * （Access のポリシーが門番。docs/spec.md §3）。
 */
export async function renderAdmin(env: Env): Promise<string> {
  const [deliveries, runs] = await Promise.all([
    listDeliveries(env.DB, { limit: 200 }),
    listRunLogs(env.DB, 20),
  ]);

  const deliveryRows = deliveries
    .map(
      (row) => `<tr>
      <td><code>${escapeHtml(row.path)}</code></td>
      <td>${escapeHtml(row.destination)}</td>
      <td>${escapeHtml(row.action)}</td>
      <td class="s-${escapeHtml(row.status)}">${escapeHtml(STATUS_LABELS[row.status] ?? row.status)}</td>
      <td>${row.attempt}</td>
      <td>${
        row.external_uri
          ? `<a href="${escapeHtml(row.external_uri)}">${escapeHtml(row.external_uri.slice(0, 48))}…</a>`
          : '—'
      }</td>
      <td class="err">${row.error ? escapeHtml(row.error.slice(0, 120)) : ''}</td>
      <td>${escapeHtml(row.updated_at.replace('T', ' ').slice(0, 19))}</td>
      <td>
        <form method="post" action="/admin/deliveries/${row.id}/retry">
          <button type="submit">再送</button>
        </form>
      </td>
    </tr>`,
    )
    .join('\n');

  const runRows = runs
    .map(
      (row) => `<tr>
      <td>${escapeHtml(row.started_at.replace('T', ' ').slice(0, 19))}</td>
      <td>${escapeHtml(row.trigger)}</td>
      <td class="err">${row.error ? escapeHtml(row.error) : ''}</td>
      <td><code>${escapeHtml(row.summary)}</code></td>
    </tr>`,
    )
    .join('\n');

  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Syndicator</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 13px/1.6 ui-monospace, SFMono-Regular, Menlo, monospace; margin: 0; padding: 20px; background: #0b0e14; color: #e6e8eb; }
  h1 { font-size: 15px; margin: 0 0 4px; }
  h2 { font-size: 13px; margin: 28px 0 8px; color: #98a2b3; font-weight: 600; }
  p.meta { color: #98a2b3; margin: 0 0 8px; }
  table { border-collapse: collapse; width: 100%; margin-bottom: 8px; }
  th, td { border: 1px solid #222c3a; padding: 4px 6px; text-align: left; vertical-align: top; }
  th { background: #141a24; color: #98a2b3; font-weight: 600; position: sticky; top: 0; }
  a { color: #7aa7ff; }
  code { color: #c9d1d9; }
  .err { color: #ff9f9f; }
  .s-sent { color: #7ee2a8; }
  .s-dead { color: #ff9f9f; font-weight: 700; }
  .s-pending { color: #ffd479; }
  button { font: inherit; background: #222c3a; color: #e6e8eb; border: 1px solid #334154; border-radius: 4px; padding: 2px 8px; cursor: pointer; }
  button:hover { border-color: #7aa7ff; color: #7aa7ff; }
  form { margin: 0; }
</style>
</head>
<body>
  <h1>Syndicator</h1>
  <p class="meta">dry-run: ${env.DRY_RUN === 'true' ? 'ON' : 'off'} / 有効な Destination: ${escapeHtml(
    env.ENABLED_DESTINATIONS ?? 'bluesky',
  )}</p>

  <h2>Delivery（直近 200 件）</h2>
  <table>
    <thead><tr><th>path</th><th>宛先</th><th>動作</th><th>状態</th><th>試行</th><th>外部</th><th>エラー</th><th>更新</th><th></th></tr></thead>
    <tbody>${deliveryRows || '<tr><td colspan="9">まだありません</td></tr>'}</tbody>
  </table>

  <h2>Run（直近 20 件）</h2>
  <table>
    <thead><tr><th>開始</th><th>トリガー</th><th>エラー</th><th>サマリ</th></tr></thead>
    <tbody>${runRows || '<tr><td colspan="4">まだありません</td></tr>'}</tbody>
  </table>
</body>
</html>`;
}
