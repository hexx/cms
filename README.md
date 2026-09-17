# hexx.jp

hexx.jp の個人ブログ。Markdown を git に置き、Cloudflare Workers の静的アセットとして配り、公開した記事を standard.site のレコードとして AT Protocol に登録し、各 SNS へ配信する。

- 仕様: [docs/spec.md](./docs/spec.md)
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
| P4 | Threads / Discord 通知 / X 手動ボタン | 未着手 |
| P5 | 削除伝播の全宛先化、Backfill、Runbook | 未着手 |

## セットアップ

```bash
npm install
npm run dev            # サイト (http://localhost:4321)
```

## よく使うコマンド

```bash
npm run dev            # サイトの開発サーバー
npm run build          # site/dist を生成（prebuild で検証が走る）
npm run validate       # frontmatter / slug 一意性 / .well-known の整合を検証
npm test               # shared / site / syndicator のテスト
npm run lint           # oxlint --deny-warnings
npm run typecheck      # tsc / astro check

npm run db:local       # Syndicator の D1 マイグレーション（ローカル）
npm run db:remote      # 同上（本番）
npm run images -w site # OGP 既定画像とアイコンを再生成（要コミット）
```

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

- **slug はファイル名**で、Post / Note をまたいで一意でなければならない（ビルドが落ちる）。ATProto の `rkey` に `/` が使えないため。
- **`publishedAt` と slug は公開後に変えない**。URL と standard.site のレコードの同一性が壊れるため。修正は `updatedAt` で表す。
- Note は本文がそのまま SNS に流れる。140 グラフェムくらいを目安にする。
- 予約投稿は未対応（書いたら即公開）。
- 記事を消す（または `draft: true` に戻す）と、フィードから消える → レコードと SNS 投稿も自動で削除される。

## デプロイ

Cloudflare Workers Builds に2プロジェクトを作る。

| プロジェクト | root | ビルド |
|---|---|---|
| `hexx-blog` | `site` | `npm run build -w site` → 静的アセットをデプロイ |
| `hexx-syndicator` | `syndicator` | `npm run db:migrate:remote -w syndicator` → `wrangler deploy` |

watch paths（`site/**` と `syndicator/**`）で分離する。blog のデプロイ後に `POST https://syndicator.hexx.jp/syndicate` を叩くフックを張ると即時に配信され、張らなくても Cron が10分ごとに拾う。

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
| `DISCORD_WEBHOOK_URL` | 任意。配信結果の通知先 |

`ENABLED_DESTINATIONS`（カンマ区切り、既定 `bluesky`）で有効な宛先を切り替える。指定できるのは `bluesky,mastodon,misskey,nostr,threads,discord` で、実装されていない宛先（現状 `threads` / `discord`）を有効にすると、その Delivery は `dead` になって Discord に通知される。

`NOSTR_RELAYS` を省略すると sns-client と同じ固定リレーセット（`yabu.me` / `relay.damus.io` / `nos.lol` / `relay.nostr.band` / `relay.primal.net` / `nostr.hiroba.media`）を使う。1つでもリレーが受理すれば配信成功とする。

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

`DRY_RUN=true` では送信もレコード書き込みもせず、計画と送信内容だけを記録する。

### 運用

- 管理画面: `https://syndicator.hexx.jp/admin`（Cloudflare Access で保護する。`/admin*` にアプリを張る）
- 配信の失敗は指数バックオフ（1分 → 5分 → 30分 → 2時間 → 12時間）で再試行し、5回失敗で `dead` + Discord 通知
- フィードが空になったときは削除伝播をしない（壊れたデプロイで全記事を消さないための安全装置）
