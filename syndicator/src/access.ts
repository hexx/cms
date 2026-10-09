/**
 * Cloudflare Access が付与する JWT（`Cf-Access-Jwt-Assertion`）の検証。
 *
 * 「ヘッダーがあるか」だけを見ると、誰でも同じ名前のヘッダーを付けて
 * 管理画面を通り抜けられてしまう（実際に 200 が返ることを確認済み）。
 * Access の公開鍵（JWKS）で署名を検証し、`aud` と有効期限まで見る。
 *
 * 必要な設定:
 *   ACCESS_TEAM_DOMAIN  https://<team>.cloudflareaccess.com
 *   ACCESS_AUD          Access アプリケーションの Audience (AUD) タグ
 */

type AccessKey = JsonWebKey & { kid?: string };

type VerifyResult = { ok: true } | { ok: false; reason: string };

const JWKS_TTL_MS = 5 * 60 * 1000;
const JWKS_TIMEOUT_MS = 5_000;

let cache: { teamDomain: string; keys: AccessKey[]; fetchedAt: number } | null = null;

/** テスト用にキャッシュを捨てる */
export function resetAccessKeyCache(): void {
  cache = null;
}

function base64UrlToBytes(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function decodeJson<T>(value: string): T | null {
  try {
    return JSON.parse(new TextDecoder().decode(base64UrlToBytes(value))) as T;
  } catch {
    return null;
  }
}

async function fetchKeys(teamDomain: string): Promise<AccessKey[]> {
  const url = `${teamDomain.replace(/\/+$/, '')}/cdn-cgi/access/certs`;
  const response = await fetch(url, { signal: AbortSignal.timeout(JWKS_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`JWKS を取得できません: ${response.status}`);
  const body = (await response.json()) as { keys?: AccessKey[] };
  return body.keys ?? [];
}

async function getKeys(teamDomain: string, force: boolean): Promise<AccessKey[]> {
  const now = Date.now();
  if (!force && cache && cache.teamDomain === teamDomain && now - cache.fetchedAt < JWKS_TTL_MS) {
    return cache.keys;
  }
  const keys = await fetchKeys(teamDomain);
  cache = { teamDomain, keys, fetchedAt: now };
  return keys;
}

/**
 * Access の JWT を検証する。
 * 例外は投げず、失敗は理由つきで返す（呼び出し側でログに出す）。
 */
export async function verifyAccessToken(
  token: string,
  options: { teamDomain: string; aud: string; now?: Date },
): Promise<VerifyResult> {
  const parts = token.split('.');
  if (parts.length !== 3) return { ok: false, reason: 'JWT の形が不正' };
  const [headerPart, payloadPart, signaturePart] = parts as [string, string, string];

  const header = decodeJson<{ alg?: string; kid?: string }>(headerPart);
  const payload = decodeJson<{ aud?: string | string[]; exp?: number }>(payloadPart);
  if (!header || !payload) return { ok: false, reason: 'JWT を解釈できません' };
  if (header.alg !== 'RS256') return { ok: false, reason: `未対応の alg: ${header.alg ?? '(なし)'}` };

  const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!audiences.includes(options.aud)) return { ok: false, reason: 'aud が一致しません' };

  const now = options.now ?? new Date();
  if (typeof payload.exp === 'number' && payload.exp * 1000 < now.getTime()) {
    return { ok: false, reason: 'JWT の有効期限が切れています' };
  }

  let key: AccessKey | undefined;
  try {
    let keys = await getKeys(options.teamDomain, false);
    key = keys.find((candidate) => candidate.kid === header.kid);
    if (!key) {
      // 鍵がローテーションされた可能性があるので、キャッシュを無視して取り直す
      keys = await getKeys(options.teamDomain, true);
      key = keys.find((candidate) => candidate.kid === header.kid);
    }
  } catch (error) {
    return { ok: false, reason: `公開鍵を取得できません: ${String(error)}` };
  }
  if (!key) return { ok: false, reason: 'kid に対応する公開鍵がありません' };

  try {
    const cryptoKey = await crypto.subtle.importKey(
      'jwk',
      key,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify'],
    );
    const valid = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      cryptoKey,
      base64UrlToBytes(signaturePart),
      new TextEncoder().encode(`${headerPart}.${payloadPart}`),
    );
    return valid ? { ok: true } : { ok: false, reason: '署名が一致しません' };
  } catch (error) {
    return { ok: false, reason: `署名を検証できません: ${String(error)}` };
  }
}
