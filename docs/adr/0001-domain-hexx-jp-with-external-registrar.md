# ドメインは hexx.jp。登録は国内レジストラ、DNS は Cloudflare

Cloudflare Registrar は .jp を扱えない（2026年時点）。一方 standard.site の publication レコードは `url` にドメインを焼き込み、ATProto のハンドル、フィード、被リンクもドメインに紐づくため、後からドメインを変えるコストが高い。よって XSERVERドメイン等の国内レジストラで hexx.jp を取得し、ネームサーバーを Cloudflare に委譲して DNS・Worker のカスタムドメイン・DNSSEC を Cloudflare 側で運用する。ドメイン管理を Cloudflare Registrar に一元化する利点は諦める。

## Considered Options

- Cloudflare Registrar で取れる TLD（hexx.dev 等）に変える — 管理は一元化できるが、same-domain での identity を失い、ユーザーの希望ドメインとも異なる
- 両方取る — 更新管理が2系統になり、正典が曖昧になる

## Consequences

- **DNSSEC は使えない**。DS レコードの登録はレジストラの機能で、XSERVERドメインにはその設定項目がない。Cloudflare 側で DNSSEC を有効にしても DS が無いため検証されず、移管時に解除作業が必要になるのでオフのまま運用する。DNSSEC が必要になったら、DS 登録に対応したレジストラへ移管する（ネームサーバーは Cloudflare のままでよい）
- 更新は年1回・国内レジストラ側で行う。自動更新と支払い方法の維持が死活問題になる（失効＝全リンク・ATProto ハンドル・standard.site 検証が壊れる）
- ATProto ハンドルを hexx.jp に固定するため、将来 PDS を移行してもハンドルは変わらない
- whois 公開代行の有無・移管ポリシーはレジストラ依存になる
