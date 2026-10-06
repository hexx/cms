# hexx.jp

hexx.jp の個人ブログ。Markdown を git に置き、Cloudflare Workers の静的アセットとして配り、公開した記事を standard.site のレコードとして AT Protocol に登録し、各 SNS へ配信する。

- 仕様: [docs/spec.md](./docs/spec.md)
- 運用手順: [docs/runbook.md](./docs/runbook.md)
- 決定の記録: [docs/adr/](./docs/adr/)
- 用語: [CONTEXT.md](./CONTEXT.md)

```
packages/shared/   型・設定・frontmatter スキーマ・URL 導出・ハッシュ（site と syndicator で共有）
site/              Astro。hexx.jp に配る静的サイト（blog Worker。Worker コードを持たない）
syndicator/        Cloudflare Worker。ATProto レコードの書き込みと SNS 配信（D1 + Cron）
```

## 現在の状態

| Phase | 内容 | 状態 |
|---|---|---|
| P1 | サイト基盤（Astro、Post/Note、フィード、OGP、standard.site の検証ファイルと link タグ） | ✅ |
| P2 | Syndicator（D1、差分検出、publication/document レコード、Bluesky 配信、Cron、`/admin`、dry-run） | ✅ |
| P3 | Mastodon / Misskey / Nostr | ✅ |
| P4 | Threads / Discord 配信 / X 手動ボタン | ✅ |
| P5 | 削除伝播（全宛先）、Backfill、管理画面、Runbook | ✅ |

## セットアップ

```bash
npm install
npm run dev            # サイト (http://localhost:4321)
```

> **`NODE_ENV=production` でインストールする場合**
> ビルドとデプロイに必要なもの（`astro` / `yaml` / `mdast-util-from-markdown` / `wrangler`）は
> `dependencies` に置いています。`--omit=dev` でもビルドとデプロイが通るようにするためです。
> 逆に `devDependencies` 側（`typescript` / `vitest` / `sharp` / `@astrojs/check`）は
> テスト・型チェック・画像生成にしか使いません。

## よく使うコマンド

> **必ずリポジトリのルートで実行してください。**
> `npm run -w <name>` はワークスペースのディレクトリ内（`site/` や `syndicator/`）から実行すると
> `No workspaces found` で失敗します（npm の仕様）。ルートから使えるスクリプトを用意しています。

```bash
npm run dev                # サイトの開発サーバー
npm run build              # site/dist を生成（prebuild で検証が走る）
npm run validate           # frontmatter / slug 一意性 / .well-known の整合を検証
npm test                   # shared / site / syndicator のテスト
npm run lint               # oxlint --deny-warnings
npm run typecheck          # tsc / astro check

npm run deploy:site        # ブログをデプロイ（hexx-blog）
npm run deploy:syndicator  # Syndicator をデプロイ（hexx-syndicator）
npm run bootstrap          # publication レコードを作成（初回のみ）
npm run db:local           # Syndicator の D1 マイグレーション（ローカル）
npm run db:remote          # 同上（本番）

npm run images -w site     # OGP 既定画像とアイコンを再生成（要コミット）
```

`npm run images -w site` だけは例外的に `-w` を使っていますが、これもルートから実行します。

## 記事を書く

`site/src/content/posts/<slug>.md`（長文）か `site/src/content/notes/<slug>.md`（短文）を追加する。

```yaml
---
title: 記事タイトル # 必須
publishedAt: 2026-09-18T10:00:00+09:00 # 必須。URL の年月がここから決まる
description: 一覧と SNS カードに出る要約 # 任意
tags: [atproto, blogging] # 任意、最大5件
coverImage: /images/cover.png # 任意（site/public 配下）
updatedAt: 2026-09-20T09:00:00+09:00 # 任意
draft: false # 任意
---
本文（Markdown）
```

決まりごと:

- **slug はファイル名**で、小文字英数字と `. _ ~ -` だけの1セグメント。Post / Note をまたいで一意でなければならない（ビルドが落ちる）。ATProto の `rkey` に `/` が使えないため。
- `tags` に空白・`/`・`?`・`#`・`.` は使えない（URL のセグメントとハッシュタグに使うため）。
- **`publishedAt` と slug は公開後に変えない**。URL と standard.site のレコードの同一性が壊れるため。修正は `updatedAt` で表す。
- Note は本文がそのまま SNS に流れる。140 グラフェムくらいを目安にする。
- 予約投稿は未対応（書いたら即公開）。
- 記事を消す（または `draft: true` に戻す）と、フィードから消える → レコードと SNS 投稿も自動で削除される。

## デプロイ

```bash
npx wrangler login                                  # 初回のみ
cd syndicator && npx wrangler d1 create hexx-syndicator   # database_id を wrangler.jsonc に貼る
```

`wrangler.jsonc` の `name` がそのまま Worker 名になる（`hexx-blog` / `hexx-syndicator`）。
Worker はデプロイ時に作られるので、**先に手元から1回デプロイ**して動きを確認する。

```bash
npm run build && npm run deploy:site            # hexx-blog
npm run db:remote && npm run deploy:syndicator  # hexx-syndicator
```

### Workers Builds（push で自動デプロイ）

ダッシュボード → Workers & Pages → 対象の Worker → Settings → Builds → Connect to Git。
**root directory はリポジトリのルート**にする（`package-lock.json` と workspaces がルートにあるため）。
`-w` を付けた npm スクリプトは cwd が各ワークスペースになるので、wrangler が正しい `wrangler.jsonc` を見つける。

| 項目 | `hexx-blog` | `hexx-syndicator` |
|---|---|---|
| Root directory | `/`（空のまま） | `/`（空のまま） |
| Build command | `npm run build -w site` | `npm run db:migrate:remote -w syndicator` |
| Deploy command | `npm run deploy -w site` | `npm run deploy -w syndicator` |
| Build watch paths（include） | `site/*`, `packages/*` | `syndicator/*`, `packages/*` |

`packages/shared` を両方が使うので、include に `packages/*` を入れておく。
マイグレーションを build 側に置いているのは、失敗したときにデプロイさせないため。

デプロイ後に即座に配信したい場合は、Workers Builds の Event Subscriptions（`build.succeeded` を Queue 経由で購読）で Syndicator を叩ける。張らなくても Cron が10分ごとに拾うので必須ではない。

## Syndicator

### 設定

`config.json` がサイトの同一性（URL・名前・説明・テーマ・`pdsHost`・`publicationAtUri`）の唯一のソース。`.well-known/site.standard.publication` はビルド時にここから生成される（git 管理外）。

`publicationAtUri` が `at://did:plc:REPLACE_ME/...` のままだとレコードを書き込まずに失敗する（ビルドは警告のみで通る）。

### シークレット（`wrangler secret put`）

| 名前 | 用途 |
|---|---|
| `SYNDICATE_SECRET` | デプロイフック用の共有シークレット（`X-Syndicate-Secret`） |
| `ADMIN_TOKEN` | 読み取り API / 管理操作用の Bearer トークン |
| `BSKY_HANDLE` / `BSKY_APP_PASSWORD` | Bluesky への投稿と standard.site レコードの書き込み |
| `MASTODON_TOKEN` | Mastodon への投稿（インスタンス URL は `wrangler.jsonc` の vars でも可） |
| `MISSKEY_TOKEN` | Misskey への投稿（インスタンスは vars の `MISSKEY_INSTANCE_URL`、既定 `https://misskey.io`） |
| `NOSTR_NSEC` | Nostr への投稿（`nsec1...` か 64 桁 hex）。**Syndicator にしか置かない** |
| `DISCORD_WEBHOOK_URL` | Discord への配信（embed 1枚）。運用通知もここに来る |
| `DISCORD_NOTIFY_WEBHOOK_URL` | 任意。運用通知だけ別チャンネルに分けたいとき |

`THREADS_USER_ID` は vars（`wrangler.jsonc`）に置く。アクセストークンは 60 日で切れるため D1 に保存し、20時間以上経ったら run ごとに自動更新する。

`ENABLED_DESTINATIONS`（カンマ区切り、既定 `bluesky`）で有効な宛先を切り替える。`bluesky,mastodon,misskey,nostr,threads,discord` の6つ。資格情報が無い宛先を有効にすると、その Delivery は `dead` になって Discord に通知される（有効化したまま忘れないように）。

`NOSTR_RELAYS` を省略すると sns-client と同じ固定リレーセット（`yabu.me` / `relay.damus.io` / `nos.lol` / `relay.nostr.band` / `relay.primal.net` / `nostr.hiroba.media`）を使う。1つでもリレーが受理すれば配信成功とする。

### Threads のトークン登録（初回のみ）

Meta の開発者アプリで `threads_basic` / `threads_content_publish` を有効にし、Threads API のセットアップで長期トークンを発行してから:

```bash
curl -X POST https://syndicator.hexx.jp/v1/credentials/threads \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"userId":"<Threads のユーザー ID>","accessToken":"<長期トークン>"}'
```

`THREADS_USER_ID` を `wrangler.jsonc` の vars に入れておけば `userId` は省略できる。以後の更新は Cron が行う（60日で切れるため）。

### ブートストラップ（初回のみ）

```bash
SYNDICATOR_URL=https://syndicator.hexx.jp ADMIN_TOKEN=... \
  npm run bootstrap -w syndicator -- --write
```

`POST /v1/publication` で publication レコード（rkey = `self`）を作り、`config.json` の `publicationAtUri` を更新する。Bluesky のハンドル設定用 `_atproto` TXT の値も表示される。

### ローカルで通しで試す（DRY_RUN）

```bash
npm run build -w site
python3 -m http.server 8789 --directory site/dist &
cp syndicator/.dev.vars.example syndicator/.dev.vars   # FEED_URL と DRY_RUN=true が入っている
npm run db:local && npm run dev -w syndicator
curl -X POST http://127.0.0.1:8790/syndicate -H 'X-Syndicate-Secret: local-secret'
curl -H 'Authorization: Bearer local-token' http://127.0.0.1:8790/v1/deliveries
```

`DRY_RUN=true` では **D1 も外部も一切書き換えない**（フィードを読んで「何が起きるはずか」と各宛先に送る内容をログに出すだけ）。dry-run の後に本番 run を流せば通常どおり処理される。

### Backfill（後から宛先を足したとき）

```bash
curl -X POST https://syndicator.hexx.jp/v1/backfill \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' \
  -d '{"destination":"nostr","since":"2026-01-01T00:00:00.000Z"}'
```

まだ Delivery が無い記事だけを予約する。送信済みも送り直したいときだけ `"force": true` を付ける。

### 運用

- 管理画面: `https://syndicator.hexx.jp/admin`（Cloudflare Access で保護する。`/admin*` にアプリを張る）
- 手順書: [docs/runbook.md](./docs/runbook.md)（失敗時の切り分け、再送、ローテーション、緊急停止、D1 の復元）
- 配信の失敗は指数バックオフ（1分 → 5分 → 30分 → 2時間 → 12時間）で再試行し、それでも失敗したら `dead` + Discord 通知
- 実行は D1 のロックで直列化する（Cron とデプロイフックが重なっても二重処理しない）
- 送信中のまま10分以上経った Delivery は再試行に戻す
- フィードが空になったときは削除伝播をしない（壊れたデプロイで全記事を消さないための安全装置）
