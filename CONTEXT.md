# cms

hexx.jp の個人ブログと、その配信（Syndication）システム。著者は一人。

## Language

### Publishing

**Publication**:
hexx.jp のブログ全体を表す standard.site の単位。URL と名前を持ち、複数の Document を束ねる。
_Avoid_: サイト, channel, feed

**Document**:
standard.site 上で一つの読み物を表す単位。Post と Note の総称。1 Document = 1 レコード。
_Avoid_: 記事レコード, item

**Post**:
長文の Document。`/posts/YYYY/MM/<slug>` に置かれる。
_Avoid_: 記事, article, entry

**Note**:
短文の Document。`/notes/YYYY/MM/<slug>` に置かれる。
_Avoid_: つぶやき, tweet, メモ

**Canonical URL**:
Post/Note の正典の場所。Publication の url と Document の path を連結したもの。ATProto のハンドルも、SNS への配信も、常にここを指す。
_Avoid_: permalink, 記事URL

**Slug**:
Canonical URL の末尾。ファイル名でもあり、Document Record の rkey でもある。一度公開したら変更しない。
_Avoid_: ファイル名, ID

**Draft**:
まだ公開していない Document。サイトにもレコードにも Destination にも存在しない。
_Avoid_: 下書き記事, unpublished

### ATProto

**Publication Record**:
Publication を ATProto 上に表した `site.standard.publication` レコード。Publication ごとに1つだけ存在する。
_Avoid_: サイトレコード, publication レコード

**Document Record**:
Document を ATProto 上に表した `site.standard.document` レコード。Document ごとに1つだけ存在する。
_Avoid_: 記事レコード, document レコード

**Syndicator**:
Syndication を実行する唯一の主体。Publication Record / Document Record の書き込みと、各 Destination への Delivery を担う。
_Avoid_: 配信ワーカー, publisher, 配信サーバー

### Distribution

**Syndication**:
公開した Document を Destination にも複製投稿すること。正典は常に Canonical URL であり、SNS 側は写しである。
_Avoid_: 転載, クロスポスト

**Destination**:
Syndication の宛先となる外部プラットフォーム。
_Avoid_: チャネル, SNS（個々を指すときは Destination を使う）

**Delivery**:
1つの Document を1つの Destination へ送る1回の試行と、その結果。成功した Delivery は再送しない。
_Avoid_: 投稿, job, 送信

**Manual Destination**:
API による自動配信を持たず、Web Intent 等で人が投稿する Destination。X だけがこれにあたる。
_Avoid_: 手動投稿先, 未対応SNS

**Backfill**:
公開済みの Document を、後から追加した Destination へまとめて Syndication すること。
_Avoid_: 再送, 再配信
