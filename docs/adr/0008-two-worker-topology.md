# blog は静的アセットのみ、syndicator は別 Worker

`hexx.jp` を配信する blog Worker は **Worker コードを持たない静的アセットのみ**とし、API・Cron・D1・シークレットを持つ syndicator Worker を `syndicator.hexx.jp` に分離する。公開面にシークレットも Cron も存在しない状態を保ち、コンテンツ公開と配信コードのデプロイを独立して行えるようにする。

## Considered Options

- **1 Worker 構成**（静的アセット + Hono API + `run_worker_first: ["/api/*"]`）: sns-client と同じ構成でデプロイが1本にまとまる。ただし公開ブログのデプロイが配信コードと運命を共にし、公開 Worker にシークレットのバインディングが載る
- **blog も Worker にして `/admin` を同居**: 管理画面のホストが1つで済むが、「公開面と管理面を分ける」という目的を失う

## Consequences

- Cloudflare Workers Builds のプロジェクトを2つ作り、watch paths（`site/**` / `syndicator/**`）でビルドを分離する
- 管理画面は `syndicator.hexx.jp/admin` に置き、Cloudflare Access（sns-client と同じメールポリシー）で保護する
- blog のデプロイは静的ファイルのアップロードだけになり、速く・壊れにくくなる
- 将来 API を増やす場合も、公開面にコードを足さない原則を維持できる
