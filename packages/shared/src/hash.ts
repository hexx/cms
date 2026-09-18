/** キーを再帰的にソートした JSON。ハッシュの安定化に使う */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  // Date など JSON.stringify が自前で文字列化する値はそのまま渡す
  // （そうしないと `{}` に潰れて別の日時が同じハッシュになる）
  if (value instanceof Date) return value;
  if (value && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      const child = source[key];
      if (child === undefined) continue;
      out[key] = sortValue(child);
    }
    return out;
  }
  return value;
}

/** 16進数小文字の SHA-256（Web Crypto / Node の globalThis.crypto で動く） */
export async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Document の内容ハッシュ。Syndicator が「新規」「更新」「消滅」を判定するために使う。
 * 同じ内容なら同じ値になる（キー順に依存しない）。
 */
export async function contentHash(input: unknown): Promise<string> {
  return `sha256:${await sha256Hex(canonicalJson(input))}`;
}
