# 更新は SNS に再投稿しない。削除は全 Destination に伝播させる

Post/Note を書き直したときは、standard.site のレコードを `putRecord` で更新（`updatedAt` を更新）し、サイトを再ビルドするだけにする。SNS 側の投稿には触れない。一方、Document を削除・非公開にしたときは、standard.site のレコードを削除し、配信済みの全 Destination の投稿も削除する（Bluesky / Mastodon / Misskey / Threads / Discord は削除API、Nostr は NIP-09 の削除イベント）。

## Considered Options

- **更新時に SNS へ訂正投稿する**: 読者に届くが、誤字修正のたびにタイムラインが汚れる
- **削除時に SNS を残す（リンク切れを許容）**: 手間は減るが、読者に404を踏ませ、standard.site 上もレコードだけが残る

## Consequences

- SNS 上の投稿文面とサイトの最新内容がずれる可能性がある（リンク先は常に最新なので実害は小さい）
- 削除の伝播は Destination ごとに API の有無・仕様が異なるため、Syndicator に Destination ごとの削除実装が必要になる（Backfill と対になる処理）
- 一度削除した Document を復活させる場合、同じ rkey でレコードを作り直すが、SNS への再配信は Delivery の状態と衝突するため、明示的な「再配信」操作を必要とする
