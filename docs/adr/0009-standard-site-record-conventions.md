# standard.site レコードは rkey=slug / publication rkey=self、validate: false で書く

`site.standard.document` の rkey は **slug**、`site.standard.publication` の rkey は **`self`** に固定する。ATProto の rkey に `/` は使えないため URL の path をそのまま流用できない。slug を Post / Note 全体で一意にすることで rkey が Canonical URL の末尾と一致し、レコードとページの対応が人間にも機械にも読める。PDS は `site.standard.*` をホストしないため `validate: false` で書き込み、クライアント側の zod 検証で担保する。更新は `putRecord` による upsert とし、`content`（open union）は使わず `textContent` に全文プレーンテキストを入れる（正典はサイトの HTML）。

## Consequences

- slug は公開後に変更しない（レコードの URI と path の同一性を守るため）
- `publishedAt` も公開後に変更しない（Canonical URL を決めるため）。修正は `updatedAt` で表す
- Document Record の削除・再作成は「別の Document」になるため、削除後の復活は明示的な再配信操作を必要とする
- `.well-known/site.standard.publication` と `<link>` タグの AT-URI は `packages/shared/src/config.ts` の単一定数から生成し、ビルド時に一致を検証する
