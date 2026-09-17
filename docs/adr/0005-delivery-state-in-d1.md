# 配信状態は D1 の Delivery テーブルで管理し、成功済みは再送しない

Syndication は「1 Document × 1 Destination」を1行の Delivery として D1 に記録する。行の状態（pending / sending / sent / failed）、試行回数、次回試行時刻、外部投稿の URI を持ち、`UNIQUE(document_id, destination)` で冪等性を担保する。成功した Delivery は二度と再送しない。実行主体は Syndicator Worker ひとつに集約し、ビルド側は公開フィードの URL を渡すだけにする。

## Considered Options

- **ステートレス（投稿済みを毎回全 Destination に投げる）**: 実装は軽いが、ビルドのたびに重複投稿が起きる
- **Cloudflare Queues でリトライを委譲**: 標準的だが、無料枠とリトライ制御の都合で状態は結局 D1 に必要になる
- **GitHub Actions 内で配信を完結**: シークレットが CI に分散し、失敗時の再試行がワークフローに縛られる

## Consequences

- Delivery の状態は D1 が唯一の真実になる（リポジトリからは復元できない）。D1 の Time Travel（無料枠7日）と定期エクスポートで保全する
- 秘匿情報はすべて Syndicator Worker の Workers Secrets に集約され、CI 側には置かない
- Backfill（後から追加した Destination へ過去分を流す）も同じテーブルを pending で埋めるだけで実現できる
