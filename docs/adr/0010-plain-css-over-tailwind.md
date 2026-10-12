# スタイリング基盤は素の CSS + CSS 変数のままにする（Tailwind を採らない）

参照元のしずかなインターネットは Tailwind v4 で組まれているが、本サイトはページ数が 10 未満で、CSS 変数によるトークン化が既に済んでいる。見た目の質は色・余白・字組の設計で決まるので、道具立てを替えても上がらない。加えて Tailwind を入れると「移行」自体が作業の目的になり、`packages/shared/config.json` の `basicTheme`（publication record に載る配色）との対応が CSS とユーティリティの 2 箇所に散る。よって `docs/spec.md` §8.4 の「素の CSS + CSS 変数・外部 CSS フレームワークなし」を維持する。
