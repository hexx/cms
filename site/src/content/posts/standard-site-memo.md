---
title: standard.site について
publishedAt: 2026-09-17T20:00:00+09:00
description: このブログを standard.site に対応させた理由と、そこで何が起きるのかの覚え書き。
tags: [atproto, standard-site]
---

ブログを [standard.site](https://standard.site/) に対応させた。これは AT Protocol の上で長文を表すための lexicon の集まりで、`site.standard.publication`（ブログ全体）と `site.standard.document`（個々の記事）の2つのレコードを自分の PDS に置く。

## なぜやるのか

ブログのメタデータが、HTML と RSS の外側にも出ていく。記事へのリンクが Bluesky で「ただのリンク」ではなく「記事カード」として展開されるようになる、というのが分かりやすい効果。将来ほかのクライアントが同じレコードを読んで、購読や推薦を扱えるようになる余地も残る。

正典の記事はサーバー上の HTML のままで、ATProto 側にはメタデータとプレーンテキストを置く。**正典がどこにあるかを曖昧にしない**のが大事だと思っている。

## 実装のメモ

- `rkey` は slug。ATProto の rkey には `/` が使えないので、URL のパスをそのまま流用できない
- PDS は `site.standard.*` を知らないので `validate: false` で書く
- `.well-known/site.standard.publication` と `<link rel="site.standard.document">` の両方で検証する
- 配信（Bluesky / Mastodon / Misskey / Nostr / Threads / Discord）は別 worker が担当する

詳しい設計はリポジトリの `docs/spec.md` に置いてある。
