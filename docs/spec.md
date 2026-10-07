# hexx.jp ブログ & 配信システム 仕様

> 用語は [CONTEXT.md](../CONTEXT.md)、決定の理由は [docs/adr/](./adr/)、
> 日々の運用手順は [runbook.md](./runbook.md) を参照。
> 本書は「何を作るか」の単一の正典。

---

## 1. 目的とスコープ

### 1.1 やること

1. **hexx.jp に個人ブログを公開する**。Post（長文）と Note（短文）を Markdown で書き、Git で管理する。
2. **standard.site の発信側を最大限活用する（L2）**。publication / document の全メタデータ、ドメイン検証、Bluesky での記事カード、更新・削除のレコード同期まで。
3. **公開した Document を SNS へ自動配信する**（Syndication）。宛先は Bluesky / Mastodon / Misskey / Nostr / Threads / Discord。X は手動。
4. **配信を冪等・再試行可能・削除伝播可能にする**。

### 1.2 やらないこと

- standard.site の消費側（AppView）、PDS のセルフホスト（[ADR-0003](./adr/0003-standard-site-publisher-scope.md)）
- 予約投稿（必要になったら再審）
- サイト内コメント欄、多言語化、画像の R2 配信、OG 画像の自動生成
- X の API 自動投稿（[ADR-0004](./adr/0004-x-is-manual-web-intent.md)）
- sns-client とのコード共有、sns-client を配信バックエンドにすること（[ADR-0007](./adr/0007-boundary-with-sns-client.md)）

---

## 2. 全体構成

```
                    ┌─────────────── Cloudflare ───────────────┐
 読者 ──────────────▶ hexx.jp           blog Worker            │
                    │                   （静的アセットのみ）     │
                    │                                          │
 Writers Builds ───▶┌─ build site → deploy blog                 │
 （GitHub main push）│  └─ 完了フック ─▶ POST /syndicate         │
                    │                        │                 │
                    │                        ▼                 │
                    │  syndicator.hexx.jp  syndicator Worker    │
                    │  （Hono + D1 + Cron + Secrets）           │
                    │      │     │     │     │     │            │
                    └──────┼─────┼─────┼─────┼─────┼────────────┘
                           ▼     ▼     ▼     ▼     ▼
                        Bluesky Masto Misskey Nostr Threads Discord
                                                        （X は記事ページの手動ボタン）
```

- **2 Worker 構成**（[ADR-0008](./adr/0008-two-worker-topology.md)）。
  - `blog`: `hexx.jp` にデプロイする **Worker コードを持たない静的アセットのみ**の Worker。
  - `syndicator`: `syndicator.hexx.jp` にデプロイする API / Cron / D1 Worker。シークレットはここにしか置かない。
- **ビルドとデプロイ**は Cloudflare Workers Builds（同一リポジトリに2プロジェクトを接続し、watch paths で分離）。
- **真実の源**は Git の Markdown（[ADR-0002](./adr/0002-git-markdown-as-source-of-truth.md)）。配信状態のみ D1。

---

## 3. ドメインとルーティング

| ホスト / パス | 実体 | 保護 |
|---|---|---|
| `hexx.jp` | blog Worker（静的アセット） | なし（公開） |
| `www.hexx.jp` | → `hexx.jp` へ 301 | なし |
| `syndicator.hexx.jp/admin*` | 管理画面（HTML） | Cloudflare Access（sns-client と同じメールポリシー） |
| `syndicator.hexx.jp/v1/*` | 読み取り API | `Authorization: Bearer <ADMIN_TOKEN>` |
| `syndicator.hexx.jp/syndicate` | デプロイフック用 | `X-Syndicate-Secret`（共有シークレット）+ レート制限 |
| `syndicator.hexx.jp/health` | 死活監視 | なし |

- ドメインは国内レジストラ（第一候補 XSERVERドメイン、更新 3,102円/年）で取得し、NS を Cloudflare に委譲する（[ADR-0001](./adr/0001-domain-hexx-jp-with-external-registrar.md)）。
- **DNS は Cloudflare で運用**。ただし **DNSSEC は当面無効**（後述）。
  - DNSSEC を使うには Cloudflare が発行する DS レコードを**レジストラに登録**する必要がある
  - XSERVERドメインには DNSSEC（署名鍵）の設定項目がなく、個別対応も受け付けていない（2026年時点）
  - そのため hexx.jp では DNSSEC を有効にできない。必要になったら DS 登録に対応したレジストラ（JPDirect 等）へ**移管**する（NS は Cloudflare のままでよい）
  - ⚠️ Cloudflare 側で DNSSEC をオンにしても DS が無いので効果はなく、後で移管するときに解除が必要になる。**オフのままにする**
- ATProto ハンドル用に `_atproto.hexx.jp TXT "did=<DID>"` を置く。
- メール等は今回のスコープ外（必要になったら MX を追加）。

---

## 4. コンテンツモデル

### 4.1 Document の2種

| | Post | Note |
|---|---|---|
| 用途 | 長文の記事 | 短文（TIL・リンク・日記） |
| 置き場所 | `site/src/content/posts/<slug>.md` | `site/src/content/notes/<slug>.md` |
| Canonical URL | `/posts/YYYY/MM/<slug>` | `/notes/YYYY/MM/<slug>` |
| Bluesky 配信 | カード付きリンク投稿 | 本文そのままのテキスト投稿 |

- `YYYY/MM` は `publishedAt` から決まる。
- **slug はファイル名**で、小文字英数字と `. _ ~ -` だけの**1セグメント**（ネストしたディレクトリは不可）。Post・Note をまたいで全体で一意（重複したらビルドを失敗させる）。ATProto の `rkey` 制約に合わせるため。
- **`publishedAt` は公開後に変更しない**。変更すると Canonical URL と standard.site の `path` が変わってしまうため。修正の記録は `updatedAt` で行う。

### 4.2 frontmatter（Astro Content Collections + zod で検証）

```yaml
---
title: 記事タイトル            # 必須, ≤200 graphemes
publishedAt: 2026-09-01T12:00:00+09:00  # 必須
description: 一覧・カード・standard.site 用の要約  # 任意, ≤300 graphemes
tags: [atproto, blogging]     # 任意, 最大5件
coverImage: /images/cover.png # 任意（site/public 配下のパス）
updatedAt: 2026-09-05T09:00:00+09:00  # 任意
draft: false                  # 任意, 既定 false
lang: ja                      # 任意, 既定 ja
---
本文（Markdown）
```

- 画像は `site/public/images/` に置き、Git で管理する。
- `tags` は URL のセグメントとハッシュタグの両方に使うため、空白・`/`・`?`・`#`・`.` は使えない。
- Note の本文は 140 graphemes 以内を推奨（SNS へそのまま流れるため）。
- `draft: true` の Document はビルド対象外（URL も生成しない）。

---

## 5. standard.site 連携（発信側フル）

### 5.1 Publication レコード

コレクション `site.standard.publication`、**rkey = `self`**（[ADR-0009](./adr/0009-standard-site-record-conventions.md)）。

```json
{
  "$type": "site.standard.publication",
  "url": "https://hexx.jp",
  "name": "<Publication 名>",
  "description": "<説明>",
  "icon": { "$type": "blob", "ref": { "$link": "..." }, "mimeType": "image/png", "size": 0 },
  "basicTheme": {
    "$type": "site.standard.theme.basic",
    "background": { "$type": "site.standard.theme.color#rgb", "r": 255, "g": 255, "b": 255 },
    "foreground": { "$type": "site.standard.theme.color#rgb", "r": 17, "g": 17, "b": 17 },
    "accent":     { "$type": "site.standard.theme.color#rgb", "r": 0, "g": 102, "b": 204 },
    "accentForeground": { "$type": "site.standard.theme.color#rgb", "r": 255, "g": 255, "b": 255 }
  },
  "preferences": { "showInDiscover": true }
}
```

- `icon` は 256×256 以上の正方形。サイトのファビコンとは別に用意する。
- 内容を変えたいときは Syndicator が `putRecord` し直す（`/v1/publication` で手動同期）。

### 5.2 Document レコード

コレクション `site.standard.document`、**rkey = `<slug>`**。`validate: false` で書き込む（PDS がコミュニティ lexicon を知らないため）。

```json
{
  "$type": "site.standard.document",
  "site": "at://did:plc:xxxx/site.standard.publication/self",
  "path": "/posts/2026/09/hello-world",
  "title": "...",
  "description": "...",
  "coverImage": { "$type": "blob", "ref": { "$link": "..." }, "mimeType": "image/png", "size": 0 },
  "textContent": "本文のプレーンテキスト全文（Markdown 記号なし）",
  "tags": ["atproto", "blogging"],
  "publishedAt": "2026-09-01T03:00:00.000Z",
  "updatedAt": "2026-09-05T00:00:00.000Z",
  "bskyPostRef": { "uri": "at://did:plc:xxxx/app.bsky.feed.post/yyy", "cid": "bafy..." }
}
```

- `content`（open union）は**書かない**。正典はサイトの HTML であり、全文は `textContent` にプレーンテキストで入れる。
- `coverImage` は PDS に blob としてアップロードする（1MB 未満）。coverImage が無い場合は省略（デフォルト画像はサイト側の OGP でのみ使う）。
- `bskyPostRef` は Bluesky 配信後に埋める。

### 5.3 検証（Verification）

| 何を | どこに |
|---|---|
| publication | `https://hexx.jp/.well-known/site.standard.publication` に AT-URI を `text/plain` で1行 |
| publication 発見ヒント | **全ページ**の `<head>` に `<link rel="site.standard.publication" href="at://...">` |
| document | Document ページの `<head>` に `<link rel="site.standard.document" href="at://...">` |

- `.well-known` の中身は `packages/shared/src/config.ts` の `PUBLICATION_AT_URI` から生成し、**ビルド時に一致を検証**する。

### 5.4 書き込み手順（1 Document の公開）

1. `site.standard.document` を `putRecord`（rkey = slug）。
2. Bluesky へカード付き投稿し、返ってきた `{uri, cid}` を取得。
3. `bskyPostRef` を加えて `putRecord` し直す。
4. 他の Destination へ配信する（Bluesky の成否に依存させない）。

削除は逆順に `deleteRecord` + 各 Destination の削除 API を呼ぶ。

### 5.5 ブートストラップ（初回のみ・手動）

ローカルに App Password を置かないよう、レコード作成は **Worker にやらせる**。

1. Bluesky アカウントを用意し、ハンドルを `hexx.jp` に変更（`_atproto` TXT）。
2. Syndicator 用の App Password を発行（sns-client 用とは**別に発行する**）。
3. Syndicator をデプロイし、`BSKY_HANDLE` / `BSKY_APP_PASSWORD` / `ADMIN_TOKEN` / `SYNDICATE_SECRET` を `wrangler secret put` で設定。
4. `SYNDICATOR_URL=... ADMIN_TOKEN=... npm run bootstrap -- --write`
   - `POST /v1/publication` が publication レコード（rkey = `self`）を作り、AT-URI を返す
   - `--write` で `packages/shared/config.json` の `publicationAtUri` を更新する
   - 併せて `_atproto.hexx.jp TXT "did=..."` に貼る値も表示される
5. サイトをデプロイし、`/.well-known/site.standard.publication` と Bluesky のカード表示を確認。

---

## 6. 配信（Syndication）

### 6.1 Destination 一覧と資格情報

| Destination | 方式 | 資格情報（Workers Secret） | 削除 |
|---|---|---|---|
| **Bluesky** | ATProto API（`@atproto/api`） | `BSKY_HANDLE`, `BSKY_APP_PASSWORD` | `com.atproto.repo.deleteRecord` |
| **Mastodon** | REST `POST /api/v1/statuses` | `MASTODON_INSTANCE_URL`, `MASTODON_TOKEN` | `DELETE /api/v1/statuses/:id`（404/410 は成功扱い） |
| **Misskey** | REST `POST /api/notes/create` | `MISSKEY_INSTANCE_URL`（既定 misskey.io）, `MISSKEY_TOKEN` | `POST /api/notes/delete`（`NO_SUCH_NOTE` は成功扱い） |
| **Nostr** | relay へ kind:1 を publish（1つでも受理で成功） | `NOSTR_NSEC`, `NOSTR_RELAYS` | kind:5（NIP-09）。受理したリレーを記録していないため、削除は現在のリレー群への**ベストエフォート** |
| **Threads** | Graph API の2段階 publish（コンテナ作成 → publish。本文 500 字）。**冪等キーが無い**ため、タイムアウト時は再試行で重複投稿になりうる → `dead` になったら手動で確認してから再送する | `THREADS_USER_ID`（vars）+ 長期トークン（**D1 の `credential` に保存**し、20時間以上経ったら run ごとに更新） | `DELETE /v1.0/:id`（404 は成功扱い） |
| **Discord** | Incoming Webhook（`?wait=true` でメッセージ id を取る。embed 1枚） | `DISCORD_WEBHOOK_URL` | `DELETE /webhooks/.../messages/:id`（404 は成功扱い） |
| **X** | **手動**（Web Intent ボタン） | なし | — |

- 各 Destination は**独立**。1つの失敗が他を止めない。
- `isConfigured(ctx)` は非同期。Threads のように資格情報を D1 に置く宛先があるため、env だけで判定しない。
- 文面の組み立ては `syndicator/src/text.ts` に集約する。Post は `タイトル\nURL（+ タグ）`、Note は本文そのまま。上限に収まらないときは **URL > タイトル > ハッシュタグ** の順で守り、落とす（`composeLinkedPost`）。
- アダプタは共通インターフェース `publish(doc, { dryRun })` / `remove(delivery)` を実装し、**dry-run では HTTP を送らずリクエスト内容を返す**。

### 6.2 文面テンプレート

| Destination | Post の文面 | Note の文面 |
|---|---|---|
| Bluesky | text = `{title}`、`app.bsky.embed.external` に uri/title/description/thumb、`langs: ["ja"]` | text = 本文（上限で切り詰め）、URL があれば facet |
| Mastodon | `{title}\n{url}`（+ `#tag` 最大3） | 本文そのまま（+ タグ）、`language: "ja"`, `visibility: "public"` |
| Misskey | `{title}\n{url}`（+ `#tag` 最大3） | 本文そのまま、`visibility: "public"` |
| Nostr | `{title}\n{url}`（+ `#tag`）+ `r` タグに URL | 本文そのまま + `t` タグ |
| Threads | `{title}\n{url}`、`media_type=TEXT` | 本文そのまま |
| Discord | embed（title / description / url / thumbnail） | embed（description のみ） |
| X（手動） | `{title}` + `{url}` をプリセットした Web Intent | 同左 |

- ハッシュタグを付けるのは **Mastodon / Misskey のみ**。X・Bluesky には付けない（ノイズと文字数）。
- 本文抜粋は載せない（カードが本文を拾うため）。

### 6.3 トリガーと差分検出

1. **即時**: Workers Builds のデプロイ完了フックが `POST /syndicate` を叩く。
2. **回収**: Cron（10分ごと）が `/syndicate` と同じ処理を実行し、取りこぼしを拾う。
3. **差分**: `https://hexx.jp/feed.json` を取得し、`document_snapshot.content_hash` と比較して
   - 新規 → `delivery` に pending を挿入
   - 変更 → レコードを更新（SNS は再投稿しない）
   - 消滅 → 削除伝播

**安全装置**: フィードが空なのに手元に公開中の Document がある場合、`unpublish` は行わない（壊れたデプロイやフィードの取り違えで全記事を削除しないため）。`skippedUnpublish` として記録し、Discord へ通知する。フィードの `home_page_url` が `SITE_URL` と一致しない場合も取得時点で失敗させる。

**安全装置の出口**: 意図的に全部消したときなど、見送られた削除を実行する手段として `POST /v1/unpublish` を用意する（`{"all":true}` か `{"paths":[...]}`）。レコード削除と SNS 投稿の取り消しまでその場で処理する。安全装置が働いたことは Discord に通知されるので、気づかないまま残ることはない。

### 6.4 冪等性と再試行

- 実行は **D1 の実行ロック**（`run_lock`）で直列化する。Cron とデプロイフックが重なったら片方は `202 skipped: locked` で素通りする。ロックは2分で期限切れになるので、Worker が落ちても固まらない。

- `delivery` は `UNIQUE(path, destination)`。`pending → sending → sent`、失敗時は `attempt++` して `pending` に戻し `next_attempt_at` を設定。
- バックオフは 1分 → 5分 → 30分 → 2時間 → 12時間。**初回 + 最大5回の再試行**を行い、それでも失敗したら `dead` にして Discord へ通知する。
- `sending` のまま10分以上経った Delivery は「中断された」とみなして `pending` に戻す（Worker の落ちやタイムアウトで永久に止まらないように）。外部側が実は成功していた場合は重複投稿になりうる。
- **`sent` の Delivery は再送しない**（[ADR-0005](./adr/0005-delivery-state-in-d1.md)）。
- Delivery の確保は `UPDATE ... WHERE id = ? AND status = 'pending'` の `meta.changes` で判定する。Cron とデプロイフックが同時に走っても二重送信しない。

### 6.5 更新と削除

- **更新**: standard.site レコードの `updatedAt` を更新し、サイトを再ビルド。SNS 投稿は再投稿しない（[ADR-0006](./adr/0006-updates-do-not-resyndicate-deletes-do.md)）。
- **削除 / 非公開化**: standard.site レコードを削除し、`delivery` が `sent` の全 Destination の投稿を削除して `deleted` にする。
- **Backfill**: `POST /v1/backfill` で過去の Document を後から追加した Destination へ流す（`delivery` を pending で埋めるだけ）。

### 6.6 API

| メソッド | パス | 認証 | 用途 |
|---|---|---|---|
| GET | `/health` | なし | 死活監視（dry-run と有効 Destination を返す） |
| POST | `/syndicate` | `X-Syndicate-Secret` | デプロイフック / Cron の実行。同期のサマリを返す。実行ロックを取れなければ `202 {"skipped":"locked"}` |
| GET | `/v1/deliveries?status=&path=&limit=` | Bearer | Delivery 一覧 |
| POST | `/v1/deliveries/:id/retry` | Bearer | 手動再送（`pending` に戻して即実行） |
| GET | `/v1/runs` | Bearer | 実行履歴（`run_log`） |
| POST | `/v1/publication` | Bearer | Publication レコードの再同期（ブートストラップにも使う） |
| POST | `/v1/credentials/threads` | Bearer | Threads の長期トークンを登録（初回。以後は run が自動更新する） |
| GET | `/admin` | Cloudflare Access（または Bearer） | 管理画面（Destination の状態 + Delivery 一覧 + 実行履歴 + 再送ボタン） |
| POST | `/admin/deliveries/:id/retry` | Cloudflare Access（または Bearer） | 管理画面からの再送 |
| POST | `/v1/backfill` | Bearer | 過去分の配信。まだ Delivery が無いものを予約し、`force` で送信済みもやり直す |
| POST | `/v1/unpublish` | Bearer | 手動で非公開にする（安全装置の出口）。`{"all":true}` か `{"paths":[...]}`。レコード削除と SNS 投稿の取り消しまで進める |

---

## 7. データモデル（D1）

```sql
-- サイトが公開している Document のスナップショット（差分検出用）
CREATE TABLE document_snapshot (
  path            TEXT PRIMARY KEY,           -- /posts/2026/09/hello-world
  kind            TEXT NOT NULL,              -- 'post' | 'note'
  slug            TEXT NOT NULL,
  title           TEXT NOT NULL,
  description     TEXT,
  tags            TEXT,                       -- JSON array
  cover_image_url TEXT,
  text_content    TEXT,                       -- SNS 文面生成用（プレーンテキスト）
  published_at    TEXT NOT NULL,              -- ISO 8601
  updated_at      TEXT,
  content_hash    TEXT NOT NULL,              -- フィードが申告する内容ハッシュ
  record_hash     TEXT,                       -- 最後に ATProto レコードへ書いた内容のハッシュ
  first_seen_at   TEXT NOT NULL,
  unpublished_at  TEXT
);

-- standard.site レコードとの対応
CREATE TABLE document_record (
  path           TEXT PRIMARY KEY,
  rkey           TEXT NOT NULL UNIQUE,
  at_uri         TEXT NOT NULL,
  cid            TEXT,
  bsky_post_uri  TEXT,
  bsky_post_cid  TEXT,
  state          TEXT NOT NULL DEFAULT 'live', -- 'live' | 'deleted'
  updated_at     TEXT NOT NULL
);

-- 配信の1試行単位（冪等性の要）
CREATE TABLE delivery (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  path            TEXT NOT NULL,
  destination     TEXT NOT NULL,   -- bluesky | mastodon | misskey | nostr | threads | discord
  action          TEXT NOT NULL DEFAULT 'publish', -- publish | delete
  status          TEXT NOT NULL,   -- pending | sending | sent | dead | deleted | skipped
  attempt         INTEGER NOT NULL DEFAULT 0,
  external_uri    TEXT,            -- 投稿 URL / AT-URI / イベント id
  external_id     TEXT,            -- 削除に使う ID（status id, message id 等）
  error           TEXT,
  next_attempt_at TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  UNIQUE (path, destination)
);
CREATE INDEX idx_delivery_due ON delivery (status, next_attempt_at);

-- 自動更新が必要な資格情報（Threads の長期トークン等。P4 で使う）
CREATE TABLE credential (
  name       TEXT PRIMARY KEY,
  value      TEXT NOT NULL,        -- JSON
  expires_at TEXT,
  updated_at TEXT NOT NULL
);

-- 実行履歴（管理画面と障害調査用）
CREATE TABLE run_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at TEXT NOT NULL,
  trigger    TEXT NOT NULL,        -- cron | deploy-hook | manual-retry | admin-retry
  summary    TEXT NOT NULL,        -- JSON
  error      TEXT
);

-- 実行ロック（migration 0002）。1行だけ持ち、Cron とデプロイフックの同時実行を防ぐ
CREATE TABLE run_lock (
  id         INTEGER PRIMARY KEY CHECK (id = 1),
  started_at TEXT NOT NULL,
  trigger    TEXT NOT NULL
);
```

Cron トリガーは10分ごとに1本。`delivery` の due な行の処理と、フィード差分の回収を兼ねる。

**緊急停止**: `ENABLED_DESTINATIONS` に明示的な空文字を入れると何も配信しなくなる（未設定のときは `bluesky` にフォールバックするので、「未設定」と「空」で意味が違う）。Cron ごと止めるときは `triggers.crons` を空にしてデプロイする。

---

## 8. サイト仕様

### 8.1 ページ

| パス | 内容 |
|---|---|
| `/` | Post と Note の混在タイムライン（新しい順、ページング） |
| `/posts/` | Post 一覧 |
| `/notes/` | Note 一覧 |
| `/posts/YYYY/MM/<slug>` | Post 本文 |
| `/notes/YYYY/MM/<slug>` | Note 本文 |
| `/tags/<tag>/` | タグ別一覧 |
| `/about` | プロフィール・`rel=me` リンク |
| `/404` | 404 |

### 8.2 フィードとメタデータ

| 出力 | 内容 |
|---|---|
| `/feed.xml` | RSS 2.0（最新 `feedLimit` 件、description + リンク） |
| `/feed.json` | JSON Feed 1.1（最新 `feedLimit` 件。`content_text` と `_hexx` 拡張を含む） |
| `/feed-all.json` | **Syndicator 専用**の全件 JSON Feed。件数を絞らないので Backfill の入力になる |
| `/sitemap.xml` | 全 Document |
| `/robots.txt` | sitemap 参照。draft は noindex |
| OGP | `og:title` / `og:description` / `og:image` / `og:url` / `og:type=article`、Twitter Card `summary_large_image` |
| JSON-LD | `BlogPosting`（headline/datePublished/dateModified/author/image） |
| microformats2 | 記事に `h-entry`、サイトに `h-card`（Webmention 用） |
| Webmention | `<link rel="webmention" href="https://webmention.io/hexx.jp/webmention">`。**受信のみ**（表示・送信はスコープ外） |

### 8.3 記事末のアクション

- **共有**: Bluesky の投稿 intent（`https://bsky.app/intent/compose?text=...`）、X の Web Intent、Canonical URL のコピー。
- **「Bluesky で議論する」**: 公開されている **ATProto の公開エンドポイント** をブラウザから直接読んで実現する（自前インフラに依存しない）。
  1. `packages/shared/config.json` の `publicationAtUri` から DID を取り、`https://bsky.social/xrpc/com.atproto.repo.getRecord?repo=<did>&collection=site.standard.document&rkey=<slug>` を叩く
  2. レスポンスの `bskyPostRef.uri` を `https://bsky.app/profile/<did>/post/<rkey>` に変換し、そのスレッドへのリンクを記事末に出す
  3. レコードが無い・通信に失敗する・JS が無効な場合は**何も出さない**（プログレッシブエンハンスメント）

  実装済み（`ShareActions.astro`）。リンクは初期状態で `hidden` で、レコードが引けたときだけ表示する。PDS ホストは `config.json` の `pdsHost`（既定 `bsky.social`）。

### 8.4 スタイル

- 素の CSS + CSS 変数。ライト/ダーク対応。外部 CSS フレームワークは使わない。
- Web フォントは使わない（システムフォントスタック。日本語は Hiragino / Noto Sans JP / Meiryo を順に参照）。
- 画像は `site/public/images/` に置き `<img>` で参照する（Astro の画像最適化は使わない。必要になったら導入する）。

---

## 9. リポジトリとデプロイ

```
cms/
├── CONTEXT.md
├── docs/
│   ├── spec.md                 ← 本書
│   └── adr/0001..0009
├── package.json                # npm workspaces
├── packages/shared/            # 型・定数・ATProto テンプレート・フィード型
│   ├── config.json             # サイトの同一性（URL/名前/説明/テーマ/publicationAtUri）
│   └── src/                    # config / content(zod) / document / feed / hash / markdown
├── site/                       # Astro（blog Worker）
│   ├── src/content/posts/*.md
│   ├── src/content/notes/*.md
│   ├── src/pages/**
│   ├── public/images/**
│   ├── scripts/gen-verification.mjs   # .well-known を config から生成（prebuild）
│   ├── scripts/validate-content.mjs   # frontmatter / slug 一意性 / 検証ファイル（prebuild）
│   ├── scripts/render-og.mjs          # OGP 既定画像を生成（手動: npm run og）
│   └── wrangler.jsonc          # assets のみ（main なし、html_handling: drop-trailing-slash）
└── syndicator/                 # Worker（API + Cron + D1）— P2 以降
```

- **Workers Builds** を2プロジェクト作成する。watch paths で `site/**` と `syndicator/**` を分離。
  - blog: build `npm run build` → deploy `site/dist`（`prebuild` で検証が走り、失敗するとビルドが止まる）
  - **コマンドは必ずリポジトリのルートで実行する**（`npm run -w <name>` はワークスペース内から実行すると `No workspaces found` になる）
  - **ビルド・デプロイに必要なパッケージは `dependencies` に置く**（`astro` / `yaml` / `mdast-util-from-markdown` / `wrangler`）。`NODE_ENV=production` や `--omit=dev` のインストールでも通るようにするため。テスト・型チェック・画像生成にしか使わないものだけ `devDependencies` に置く
  - syndicator: `npm run build -w syndicator` → `wrangler deploy`（D1 マイグレーションはデプロイコマンドに含める）
- デプロイ完了フックで `POST https://syndicator.hexx.jp/syndicate` を叩く。
- **シークレットは syndicator の Workers Secrets にのみ置く**。blog 側と CI には置かない。

---

## 10. 運用

| 項目 | 内容 |
|---|---|
| 通知 | Discord へ「配信サマリ（成功/失敗/スキップ）」「最終失敗（dead）」「削除伝播の結果」「Backfill 完了」。`DISCORD_NOTIFY_WEBHOOK_URL` を設定すると配信先チャンネルと分けられる（未設定なら `DISCORD_WEBHOOK_URL` に同居） |
| 管理画面 | `syndicator.hexx.jp/admin`（Cloudflare Access）。Delivery 一覧と再送ボタン |
| ログ | Workers Logs（Workers Paid: 20M events/月、7日保持）。`run_log` は 30 日分だけ残す |
| 手順書 | [runbook.md](./runbook.md)（公開・修正・削除・再送・Backfill・ローテーション・緊急停止・復元） |
| バックアップ | D1 Time Travel（7日）+ 月次の `wrangler d1 export` を手元に保存 |
| 監視 | `GET /health`。Cron が動いていることは Discord の失敗通知で検知 |
| ドメイン | 自動更新 + 支払い方法の維持（失効＝ATProto ハンドルと検証が壊れる） |

### コスト

| 項目 | 費用 |
|---|---|
| Cloudflare Workers Paid | $5/月（**既に契約済み**） |
| D1 / Workers Logs / Static Assets | 無料枠・同梱枠内（0円） |
| ドメイン hexx.jp（XSERVERドメイン） | **3,102円/年** |
| Bluesky / Mastodon / Misskey / Nostr / Threads / Discord / X | 0円 |
| **追加コスト** | **3,102円/年のみ** |

---

## 11. 実装フェーズ

| Phase | 内容 | 完了条件 |
|---|---|---|
| **P1 基盤** ✅ | リポジトリ、Astro、Post/Note、URL、CSS、フィード、OGP、JSON-LD、`.well-known`、link タグ | `hexx.jp` でブログが読め、RSS/JSON Feed が取れ、`.well-known` が AT-URI を返す |
| **P2 配信基盤 + standard.site** ✅ | `bootstrap`、publication/document の書き込み、Bluesky 配信、D1 スキーマ、Cron、デプロイフック、dry-run、`/admin`、`config.json` の `publicationAtUri` 確定 | 記事公開 → Bluesky に記事カードが出て、`bskyPostRef` がレコードに入る。失敗しても1分後に再試行される |
| **P3 連合系** ✅ | Mastodon / Misskey / Nostr のアダプタと削除 | 3宛先に配信され、記事削除で3宛先から消える |
| **P4 残り** ✅ | Threads / Discord 配信 / X 手動ボタン | Threads に投稿され、Discord にサマリが届く |
| **P5 運用** | 削除伝播の全宛先化、Backfill、`/admin`、Runbook、`docs` 整備 | 管理画面から再送でき、過去記事を Threads だけに後から流せる |

Threads の App Review は待ち時間があるため、**P2 完了時点で審査を提出する**。

---

## 12. テスト方針

- **Destination アダプタ**: すべて `dryRun` を持ち、送信せずにリクエスト内容を返す。`fetch` をモックしたフィクスチャテストで、文面・パラメータ・冪等キーを検証する。
- **Worker**: `vitest`。**D1 互換のインメモリ SQLite**（`src/testing/d1.ts` に migration を適用）と、ATProto エージェント／`fetch` のフェイクを差し込んで `runSyndication` を通しでテストする。実際の SQL（UNIQUE 制約・`meta.changes`）で冪等性と状態機械（pending→sending→sent、失敗→バックオフ→dead、unpublish→delete）を確認する。`@cloudflare/vitest-pool-workers` は使わない（サーバ起動なしで CI が軽いことを優先）。
- **サイト**: ビルド時バリデーションをテストする（frontmatter の zod、**slug の全体一意性**、`.well-known` と `PUBLICATION_AT_URI` の一致、フィードの生成件数）。
- **lint**: `oxlint --deny-warnings`（sns-client と同じ）。
- **実地確認**: 本番前は全 Destination を dry-run で通し、その後1件だけ実配信して削除伝播まで確認する。

---

## 13. 未決・再審トリガー

| 項目 | 再審トリガー |
|---|---|
| 予約投稿（毎時ビルド） | 未来の `publishedAt` で出したい欲求が確定したとき |
| sns-client の standard.site カード対応 | 実装予定（提案として合意済み。sns-client 側の作業） |
| sns-client への配信モニター統合 | `/admin` では物足りなくなったとき |
| sns-client の `mastodon` Provider 実装 | sns-client で Mastodon を読みたくなったとき |
| Threads 審査が通らない | Threads を手動（X と同じ Web Intent）に格下げする |
| 画像の R2 配信 / OG 画像自動生成 | 画像が増えて Git が重くなったとき / OGP をリッチにしたくなったとき |
| Webmention の送信・表示 | 受信だけでは物足りなくなったとき |
| Nostr の NIP-23 長文配信 | リンク共有では物足りなくなったとき |
| 共通パッケージ抽出（cms ↔ sns-client） | アダプタが増えて重複が痛くなったとき、またはトークン更新が二重管理になったとき |
| standard.site 消費側（AppView） | 他サイトの標準.site を読みたくなったとき |
| PDS 移行 | bsky.social のポリシー変更などで必要になったとき |

---

## 14. 初期セットアップ（チェックリスト）

1. [ ] hexx.jp を国内レジストラで取得し、NS を Cloudflare へ委譲（DNSSEC はレジストラ非対応のため見送り。§3 参照）
2. [ ] Cloudflare に `blog` / `syndicator` の2 Worker とカスタムドメインを作成
3. [ ] D1 データベースを作成し、マイグレーションを適用
4. [ ] Bluesky アカウントのハンドルを `hexx.jp` に変更（`_atproto` TXT）
5. [ ] Syndicator 用 App Password を発行し、`wrangler secret put`
6. [ ] Mastodon / Misskey / Nostr / Discord の資格情報を取得し、`wrangler secret put`
7. [ ] Meta 開発者アプリを作成し、Threads の App Review を申請（P4 までに審査完了）
8. [ ] `npm run bootstrap -- --write` で publication レコードを作り、`publicationAtUri` を確定（D1 マイグレーションは先に適用しておく）
9. [ ] Workers Builds に2プロジェクトを接続（watch paths 設定）
10. [ ] Cloudflare Access のアプリを `syndicator.hexx.jp/admin*` に作成
11. [ ] デプロイし、`/.well-known/site.standard.publication` と Bluesky カードを確認
12. [ ] dry-run で全 Destination を通し、1件だけ実配信 → 削除まで確認
