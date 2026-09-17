import { DatabaseSync } from 'node:sqlite';
import schema from '../../migrations/0001_init.sql?raw';

/**
 * テスト用の D1 互換実装。インメモリ SQLite 上に migration を適用したものを返す。
 * 本番と同じ SQL（UNIQUE 制約・ON CONFLICT・meta.changes）で挙動を確かめるために使う。
 */
export function createTestDb(): D1Database {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(schema);
  return new TestD1(sqlite) as unknown as D1Database;
}

class TestD1 {
  constructor(private readonly sqlite: DatabaseSync) {}

  prepare(sql: string): TestStatement {
    return new TestStatement(this.sqlite, sql);
  }

  async exec(sql: string): Promise<{ count: number; duration: number }> {
    this.sqlite.exec(sql);
    return { count: 0, duration: 0 };
  }

  async batch(statements: TestStatement[]): Promise<unknown[]> {
    const results: unknown[] = [];
    for (const statement of statements) results.push(await statement.run());
    return results;
  }

  async dump(): Promise<ArrayBuffer> {
    throw new Error('未実装');
  }
}

class TestStatement {
  constructor(
    private readonly sqlite: DatabaseSync,
    private readonly sql: string,
    private readonly params: unknown[] = [],
  ) {}

  bind(...params: unknown[]): TestStatement {
    return new TestStatement(this.sqlite, this.sql, params);
  }

  async run(): Promise<{ success: true; results: unknown[]; meta: { changes: number } }> {
    const info = this.sqlite.prepare(this.sql).run(...(this.params as never[]));
    return { success: true, results: [], meta: { changes: info.changes } };
  }

  async first<T>(column?: string): Promise<T | null> {
    const row = this.sqlite.prepare(this.sql).get(...(this.params as never[]));
    if (row === undefined || row === null) return null;
    if (column) return (row as Record<string, unknown>)[column] as T;
    return row as T;
  }

  async all<T>(): Promise<{ success: true; results: T[]; meta: Record<string, unknown> }> {
    const rows = this.sqlite.prepare(this.sql).all(...(this.params as never[])) as T[];
    return { success: true, results: rows, meta: {} };
  }

  async raw<T>(): Promise<T[]> {
    const rows = this.sqlite.prepare(this.sql).all(...(this.params as never[])) as T[];
    return rows;
  }
}
