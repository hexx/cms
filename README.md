# hexx.jp

hexx.jp の個人ブログ。Markdown を git に置き、Cloudflare Workers の静的アセットとして配り、公開した記事を standard.site のレコードとして AT Protocol に登録し、各 SNS へ配信する。

- 仕様: [docs/spec.md](./docs/spec.md)
- 決定の記録: [docs/adr/](./docs/adr/)
- 用語: [CONTEXT.md](./CONTEXT.md)

```
packages/shared/   型・設定・frontmatter スキーマ・Markdown 変換・ハッシュ（site と syndicator で共有）
site/              Astro。hexx.jp に配る静的サイト（blog Worker）
syndicator/        Cloudflare Worker。ATProto レコードの書き込みと SNS 配信（P2 以降）
```

## 現在の状態

| Phase | 内容 | 状態 |
|---|---|---|
| P1 | サイト基盤（Astro、Post/Note、フィード、OGP、standard.site の検証ファイルと link タグ） | ✅ 実装済み |
| P2 | Syndicator（ATProto レコード、Bluesky 配信、D1、Cron） | 未着手 |
| P3 | Mastodon / Misskey / Nostr | 未着手 |
| P4 | Threads / Discord / X 手動ボタン | 未着手 |
| P5 | 運用（削除伝播、Backfill、`/admin`） | 未着手 |

## セットアップ

```bash
npm install
npm run dev            # http://localhost:4321
```

## よく使うコマンド

```bash
npm run dev            # 開発サーバー
npm run build          # dist/ を生成（prebuild で検証が走る）
npm run validate       # frontmatter / slug 一意性 / .well-known の整合を検証
npm test               # shared と site のユニットテスト
npm run lint           # oxlint --deny-warnings
npm run typecheck      # tsc / astro check

npm run og -w site     # public/og-default.png をデザインソースから再生成（要コミット）
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

## デプロイ

Cloudflare Workers Builds（プロジェクト `hexx-blog`）が `main` への push で `npm run build -w site` → `wrangler deploy`（`site/`）を実行する。ビルドに失敗するとデプロイされない。

ローカルから確認する場合:

```bash
npm run build && npx wrangler dev      # site/ で実行
npx wrangler deploy                    # site/ で実行
```

## 設定

サイトの同一性（URL・名前・説明・テーマ・`publicationAtUri`）は [packages/shared/config.json](./packages/shared/config.json) が唯一のソース。`.well-known/site.standard.publication` はビルド時にここから生成される（git 管理外）。

`publicationAtUri` が `at://did:plc:REPLACE_ME/...` のままだと、standard.site の検証は通らない（ビルドは警告を出して続行する）。P2 のブートストラップで確定させる。
