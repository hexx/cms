# Runbook

hexx.jp ブログと Syndicator の運用。「どうなっているか」は [spec.md](./spec.md)、
「なぜそうしたか」は [adr/](./adr/) を見る。

- 管理画面: `https://syndicator.hexx.jp/admin`（Cloudflare Access）
- 実行履歴: `GET /v1/runs`（Bearer `ADMIN_TOKEN`）
- 配信一覧: `GET /v1/deliveries?status=dead`（Bearer `ADMIN_TOKEN`）

---

## 日常

### 記事を公開する

```bash
$EDITOR site/src/content/posts/新しい記事.md
git commit -am "add post" && git push
```

push で Workers Builds がビルド → デプロイ → `POST /syndicate` を叩く。
Cron も10分ごとに走るので、フックが失敗しても自動で拾われる。

**注意**: ビルドが落ちると何も公開されない（`prebuild` の検証が frontmatter と slug の
一意性を見ている）。エラーは Workers Builds のログに出る。

### 記事を直す

本文・タイトル・`updatedAt` を編集して push。standard.site のレコードは更新されるが、
**SNS へは再投稿しない**（[ADR-0006](./adr/0006-updates-do-not-resyndicate-deletes-do.md)）。
URL と slug は変えない。

### 記事を消す

ファイルを削除（または `draft: true`）して push。フィードから消え、
**レコードと全 Destination の投稿が自動で削除される**。

⚠️ フィードが空になったときは削除伝播を見送る安全装置が働く（`skippedUnpublish`）。
壊れたデプロイで全記事を消さないためなので、意図的に全部消したときは手動で行う。

---

## 配信が失敗したとき

`dead` になった Delivery は Discord に通知が来る。切り分けは管理画面か `/v1/deliveries?status=dead`。

| 症状 | 見るところ | 対処 |
|---|---|---|
| `資格情報が未設定` | 管理画面の Destination 表 | `wrangler secret put` で入れ直す |
| `未実装の Destination` | `ENABLED_DESTINATIONS` | 綴りを直すか、`wrangler.jsonc` の vars を直して再デプロイ |
| `401` / `403` | `wrangler tail` | トークンの失効。再発行して secret を更新 |
| `429` | エラー本文 | レート制限。時間を置いて再送（下記） |
| `Threads のアクセストークンがありません` | `credential` テーブル | 「Threads のトークン」節の手順で登録 |
| `ログイン中のアカウント…が publication の DID…と一致しません` | `BSKY_HANDLE` と `publicationAtUri` | 別アカウントに書かないための安全装置。どちらかを直す |
| `送信中に中断されたため再試行します` | 前回の run が落ちた | 自動で再試行される。外部側が成功していた場合は重複投稿の可能性があるので、その宛先だけ確認する |
| Bluesky だけ `RecordNotFound` | `bskyPostRef` の書き戻し | 配信自体は成功している。ログの警告を確認 |

**再送**:

```bash
# 1件だけ
curl -X POST https://syndicator.hexx.jp/v1/deliveries/<id>/retry \
  -H "Authorization: Bearer $ADMIN_TOKEN"

# まとめて（失敗したものだけ）
curl -X POST https://syndicator.hexx.jp/v1/backfill \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' \
  -d '{"destination":"mastodon","force":true}'
```

管理画面の「再送」ボタンでも同じことができる。

⚠️ **Threads は再送の前に手動で確認する。** Threads API には冪等キーが無く、タイムアウトしたときに実際は投稿されていた場合、再送で二重に投稿される。他の宛先は Mastodon の `Idempotency-Key`、Nostr のイベント id、Discord のメッセージ id で追跡できる。

---

## 後から宛先を足す

1. 資格情報を `wrangler secret put`（Threads だけは「Threads のトークン」節を参照）
2. `syndicator/wrangler.jsonc` の `ENABLED_DESTINATIONS` は vars ではなく secret で渡している場合は `wrangler secret put ENABLED_DESTINATIONS` で `bluesky,mastodon,...` を設定
3. 過去の記事も流したいなら Backfill:

```bash
# 期間を絞るなら since を付ける（ISO 8601）
curl -X POST https://syndicator.hexx.jp/v1/backfill \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' \
  -d '{"destination":"nostr","since":"2026-01-01T00:00:00.000Z"}'
```

Backfill は「まだ Delivery が無いもの」だけを予約する。送信済みを**意図的に送り直す**ときだけ
`"force": true` を付ける（削除した記事の復活など）。force は連投するとスパムになるので注意。

---

## Threads のトークン

60日で切れる。**20時間以上経ったら run ごとに自動更新**するので、通常は何もしなくてよい。

初回登録:

```bash
curl -X POST https://syndicator.hexx.jp/v1/credentials/threads \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' \
  -d '{"userId":"<Threads のユーザー ID>","accessToken":"<長期トークン>"}'
```

更新に失敗し続けると配信が `dead` になる。その場合は Meta 側でトークンを再発行して上記を叩く。
`credential` テーブルの `updated_at` が更新日時なので、管理画面のエラーと併せて確認する。

---

## 秘密のローテーション

すべて Syndicator の Workers Secrets。**blog 側と CI には秘密を置かない**。

| 秘密 | 手順 |
|---|---|
| `BSKY_APP_PASSWORD` | Bluesky で新しい App Password を発行 → `wrangler secret put`。旧パスワードを revoke |
| `MASTODON_TOKEN` | インスタンス設定でトークンを再発行 → `wrangler secret put`（`Idempotency-Key` があるので取りこぼしは起きにくい） |
| `MISSKEY_TOKEN` | Misskey の設定 → API → アクセストークンを再発行 → `wrangler secret put` |
| `NOSTR_NSEC` | **鍵の変更は identity の変更**。変更すると過去の投稿と別人扱いになるので原則やらない |
| `ADMIN_TOKEN` | 新しい値を `wrangler secret put`。利用側（手元の curl、管理スクリプト）も更新 |
| `SYNDICATE_SECRET` | 同上。デプロイフックの設定も更新する |

ローテーション後は `POST /syndicate` を1回叩いて `/admin` で疎通を確認する。

---

## バックアップと復元

- **配信状態（D1）**: Time Travel で7日戻せる。
  ```bash
  npx wrangler d1 time-travel info hexx-syndicator
  npx wrangler d1 time-travel restore hexx-syndicator --timestamp <ISO8601>
  ```
- **月次の手元保存**:
  ```bash
  npx wrangler d1 export hexx-syndicator --remote --output backup-$(date +%F).sql
  ```
- **記事（正典）**: Git がそのままバックアップ。`site/src/content/` と `site/public/images/`。
- **ATProto のレコード**: PDS 上にあり、こちらのバックアップ対象ではない。消えた場合は
  `POST /syndicate` で `record_hash` が NULL の Document から作り直される
  （`document_snapshot` が残っている限り）。

---

## 緊急停止

| 止めたいもの | 方法 |
|---|---|
| 配信だけ止める | `wrangler secret put ENABLED_DESTINATIONS` に**空文字**を入れる（何も配信しなくなる。サイトは動き続ける） |
| Cron を止める | `syndicator/wrangler.jsonc` の `triggers.crons` を `[]` にしてデプロイ |
| サイトごと止める | Cloudflare の blog Worker を削除、または DNS を外す（**ドメインと ATProto ハンドルは残す**） |
| 特定の宛先だけ止める | `ENABLED_DESTINATIONS` から外す（その宛先の pending は残り、戻せば再開する） |
| 緊急に全停止 | `ENABLED_DESTINATIONS` を空にする + `triggers.crons` を空にしてデプロイ（サイトは配信され続ける） |

止めている間も `delivery` は `pending` のまま溜まる。戻したときに一気に流れるので、
長期間止めたあとは `since` を付けた Backfill の方が安全なこともある。

---

## ドメイン

**hexx.jp の失効は、サイト・ATProto ハンドル・standard.site の検証をまとめて壊す。**
国内レジストラ側で自動更新と支払い方法を必ず維持する。更新月になったら:

1. レジストラで更新（年1回・クレジットカード）
2. `dig` などで NS と `_atproto` TXT が生きているか確認
3. `curl https://hexx.jp/.well-known/site.standard.publication` が AT-URI を返すか確認

---

## 知っておくべき制約

- **Nostr の削除はベストエフォート**。受理したリレーを記録していないため、削除イベントは現在のリレー群にしか届かない。設定から外したリレーには残りうる。
- **Threads は冪等キーが無い**。`sending` のまま中断した Delivery を再試行すると重複投稿になりうる。
- **dry-run は何も書き換えない**ので、`/v1/backfill` を dry-run で叩いても予定が返るだけ（`dryRun: true`）。
- **ATProto のレコードは publication の DID にしか書かない**。`BSKY_HANDLE` が別アカウントだと run が失敗する（安全装置）。

## 障害の切り分け早見

```bash
curl https://syndicator.hexx.jp/health          # 稼働と設定の状態
npx wrangler tail hexx-syndicator                # 直近のログ
npx wrangler d1 execute hexx-syndicator --remote \
  --command "SELECT status, destination, path, attempt, error FROM delivery WHERE status != 'sent' ORDER BY updated_at DESC LIMIT 20"
```

- **配信されない**: `/health` の `destinations` を見る → `/syndicate` を叩いて 202 なら直前に run 済み
- **レコードが書かれない**: `/health` の `placeholderPublication` が true なら未ブートストラップ
- **run が失敗する**: `/v1/runs` の `error` を見る。フィード取得失敗なら Workers Builds の最新ビルドを確認
