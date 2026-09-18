declare module 'node:sqlite' {
  export class DatabaseSync {
    constructor(path: string);
    exec(sql: string): void;
    prepare(sql: string): {
      run(...params: unknown[]): { changes: number; lastInsertRowid: number };
      get(...params: unknown[]): unknown;
      all(...params: unknown[]): unknown[];
    };
    close(): void;
  }
}

declare module '*?raw' {
  const content: string;
  export default content;
}

interface ImportMeta {
  glob<T = unknown>(
    pattern: string | string[],
    options?: { query?: string; import?: string; eager?: boolean },
  ): Record<string, T>;
}
