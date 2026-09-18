-- 実行ロック。Cron とデプロイフックが同時に走って
-- 同じ Document を二重に処理するのを防ぐ（docs/spec.md §6.3）。
CREATE TABLE IF NOT EXISTS run_lock (
  id         INTEGER PRIMARY KEY CHECK (id = 1),
  started_at TEXT NOT NULL,
  trigger    TEXT NOT NULL
);
