# 配色は CSS に手書きし、`basicTheme` との一致をビルド時に強制する

配色の実体は `site/src/styles/global.css` の `:root` に置き、`packages/shared/config.json` の `basicTheme` とは独立に手で管理する。ただし publication record には色が焼き込まれ、変更には Syndicator の `putRecord` が必要という**コードからは見えない制約**があるため、prebuild の検証（`site/scripts/validate-content.mjs`）で `:root` の `--bg` / `--fg` / `--accent` / `--accent-fg` が `basicTheme` の 4 色と一致しなければビルドを止める。ずれを実行時ではなく CI（Workers Builds）で検出するのが目的。ビルド時に JSON から CSS 変数を生成する案は、`global.css` を読む人が色の定義を見つけられなくなるため採らない。
