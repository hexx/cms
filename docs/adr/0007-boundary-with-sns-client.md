# sns-client とは「対話」と「配信」で分ける。コードは共有しない

`hexx/sns-client` は「人が読み、人が書く」対話面（Provider / Source / View / Compose）であり、本プロジェクトは「正典を機械が複数の宛先へ届ける」配信面である。両者の意味論は異なる（1投稿=正確に1宛先 対 1正典=多宛先）ため、配信を sns-client の Compose API 経由にすると契約が崩れ、公開ブログの可用性が個人アプリに依存してしまう。よってコード共有・配信バックエンド化は行わず、SNS アダプタはそれぞれが持つ。

## Considered Options

- **共通パッケージの抽出**（`@hexx/sns-providers` 等）: 実装の重複は消えるが、sns-client の Provider は Source/View/セッション管理に密結合で、publisher だけを切り出すリファクタが先に必要になる。薄いアダプタ6本に対して割に合わない
- **Service Binding で sns-client を配信基盤にする**: 資格情報は一元化できるが、Access 保護下の個人アプリが公開ブログのライフラインになる。逆方向の依存は受け入れられない

## Consequences

- Bluesky の App Password は用途別に**別々に発行**する（失効・権限を独立させる）
- Nostr の nsec は **Syndicator の Workers Secrets にのみ存在**する。sns-client は ADR-0013 どおり鍵を持たず、矛盾しない
- Threads の**書き込みだけ**を Syndicator が持つ（sns-client は ADR-0011 どおり `threads` Provider を作らない）。sns-client 側の ADR にこの分担を追記する
- ブログ記事の自動 SNS 投稿は **Syndicator が唯一の経路**。sns-client から同じ記事を手で投稿しない（重複防止）
- sns-client には「配信の監視」ではなく **standard.site カード表示**を足す（本プロジェクトからの提案）
- 重複が痛くなったら（アダプタ増、トークン更新の二重管理など）共通パッケージ抽出を再審する
