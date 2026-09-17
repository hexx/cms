# standard.site は発信側フル（L2）まで。AppView と PDS セルフホストはやらない

standard.site の活用範囲を「発信側の最大」に限定する。具体的には publication/document の全メタデータ（icon, basicTheme, coverImage, textContent, tags, links, labels, updatedAt）、`.well-known` と link タグによる検証、更新・削除のレコード同期、Bluesky でのカード表示、までの実装を対象とする。消費側（`graph.subscription` / `graph.recommend` を読む自前 AppView）と PDS のセルフホストは対象外。

## Considered Options

- **L1（最小）**: レコード作成と検証だけ。実装は軽いが「最大限活用」という要求を満たさない
- **L3（全部）**: 自前 AppView や PDS まで。ブログとは別のプロダクトになり、書く・配るという本題を遅らせる

## Consequences

- ATProto の身元は bsky.social の PDS と App Password に依存する。ただしハンドルは独自ドメインなので、PDS 移行時も identity は保たれる
- `graph.subscription` / `graph.recommend` は読者側が書くレコードであり、こちらからは何もしない
- 将来 AppView を作る場合、データは既に PDS 上にあるため新規プロジェクトとして追加できる
