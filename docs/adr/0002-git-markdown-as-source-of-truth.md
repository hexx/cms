# コンテンツの真実の源は Git 上の Markdown。配信は Cloudflare Workers の静的アセット

Post/Note はリポジトリ内の Markdown + frontmatter として管理し、ビルド時に HTML・`.well-known/site.standard.publication`・`<link rel="site.standard.document">`・OGP・各種フィードを生成して、Cloudflare Workers の静的アセットとして配る。standard.site の publication / document レコードの作成・更新・削除と SNS への配信は、公開後に動く別 Worker（Syndicator）が担当する。

## Considered Options

- **D1 + Worker SSR + 管理画面**: スマホ・ブラウザから直接書ける。認証は Cloudflare Access で済む。ただしデータがDBに閉じ、バックアップ・差分・レビューが自前になる
- **R2 の Markdown + Worker レンダリング**: API で投稿でき、Git と同等のテキスト管理ができる。ただし独自のレンダリング・キャッシュ・ビルドを実装する必要がある

## Consequences

- 著者以外の認証機構を一切持たない（公開面は完全に静的）
- 予約投稿・即時プレビュー・スマホからの投稿は、ビルドとデプロイを挟む分だけ機動性で劣る。必要になったら Workers Static Assets の上に `/admin`（Cloudflare Access + GitHub Contents API）を後付けする
- 記事の正典はリポジトリ、配信状態（Delivery）は D1 と、保存場所が二つに分かれる
- レンダリングのビルド時実行により、D1 参照や画像生成などの動的処理をビルドに含められる（静的アセットでも標準機能は落ちない）
