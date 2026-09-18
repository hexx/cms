-- Syndicator のデータモデル（docs/spec.md §7）
-- 実行主体はこの D1 ひとつで、サイトの公開フィードと突き合わせて配信を進める。

-- サイトが公開している Document のスナップショット（差分検出用）
CREATE TABLE IF NOT EXISTS document_snapshot (
  path            TEXT PRIMARY KEY,           -- /posts/2026/09/hello-world
  kind            TEXT NOT NULL,              -- post | note
  slug            TEXT NOT NULL,
  title           TEXT NOT NULL,
  description     TEXT,
  tags            TEXT NOT NULL DEFAULT '[]', -- JSON array
  cover_image_url TEXT,
  text_content    TEXT,
  published_at    TEXT NOT NULL,              -- ISO 8601
  updated_at      TEXT,
  content_hash    TEXT NOT NULL,              -- フィードが申告する内容ハッシュ
  record_hash     TEXT,                       -- 最後に ATProto レコードへ書いた内容のハッシュ
  first_seen_at   TEXT NOT NULL,
  unpublished_at  TEXT
);

CREATE INDEX IF NOT EXISTS idx_snapshot_unpublished
  ON document_snapshot (unpublished_at, path);

-- standard.site レコードとの対応
CREATE TABLE IF NOT EXISTS document_record (
  path          TEXT PRIMARY KEY,
  rkey          TEXT NOT NULL UNIQUE,
  at_uri        TEXT NOT NULL,
  cid           TEXT,
  bsky_post_uri TEXT,
  bsky_post_cid TEXT,
  state         TEXT NOT NULL DEFAULT 'live', -- live | deleted
  updated_at    TEXT NOT NULL
);

-- 配信の1試行単位（冪等性の要）。UNIQUE(path, destination) が再送を防ぐ
CREATE TABLE IF NOT EXISTS delivery (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  path            TEXT NOT NULL,
  destination     TEXT NOT NULL,
  action          TEXT NOT NULL DEFAULT 'publish', -- publish | delete
  status          TEXT NOT NULL,                   -- pending | sending | sent | dead | skipped | deleted
  attempt         INTEGER NOT NULL DEFAULT 0,
  external_uri    TEXT,
  external_id     TEXT,
  error           TEXT,
  next_attempt_at TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  UNIQUE (path, destination)
);

CREATE INDEX IF NOT EXISTS idx_delivery_due ON delivery (status, next_attempt_at);

-- 自動更新が必要な資格情報（Threads の長期トークン等。P4 で使う）
CREATE TABLE IF NOT EXISTS credential (
  name       TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  expires_at TEXT
);

-- 実行履歴（管理画面と障害調査用）
CREATE TABLE IF NOT EXISTS run_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at TEXT NOT NULL,
  trigger    TEXT NOT NULL,
  summary    TEXT NOT NULL,
  error      TEXT
);
