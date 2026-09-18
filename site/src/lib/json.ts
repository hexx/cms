/**
 * `<script type="application/ld+json">` に埋め込む JSON 文字列。
 * `</script>` で要素を閉じられないよう `<` を実体参照にする。
 */
export function toJsonLd(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}
