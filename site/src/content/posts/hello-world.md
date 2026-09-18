---
title: はじめての投稿
publishedAt: 2026-09-17T21:00:00+09:00
description: ブログを作り直した。Markdown を git に置いて、Cloudflare Workers の静的アセットとして配る構成になっている。
tags: [meta]
---

ブログを作り直した。

前は書きたいときに書きにくい仕組みだったので、今回は **Markdown を git に置いて、Cloudflare Workers の静的アセットとして配る** ところから始めた。ビルドが通れば公開、失敗すれば公開されない。それだけ。

## 書くとき

```bash
$EDITOR site/src/content/posts/new-post.md
git commit -am "add post"
git push
```

frontmatter に `title` と `publishedAt` があれば、URL は `publishedAt` から自動で決まる（`/posts/2026/09/new-post`）。**一度出した URL は変えない**のが約束で、あとから直したいことは `updatedAt` に残す。

## 配信

公開したら、別の worker が Bluesky / Mastodon / Misskey / Nostr / Threads / Discord に投げる。X は課金の都合で手動のボタンにしてある。

失敗しても勝手に再試行して、それでもだめなら Discord に通知が来る。全部の配信状況は D1 に記録されている。
