import { afterEach, describe, expect, it, vi } from 'vitest';
import { resetAccessKeyCache, verifyAccessToken } from './access.ts';

const TEAM = 'https://test.cloudflareaccess.com';
const AUD = 'aud-tag-123';

/** JsonWebKey には kid が型として無いので足す（JWKS では必ず付く） */
type TestJwk = JsonWebKey & { kid: string };
type KeyPair = { privateKey: CryptoKey; jwk: TestJwk };

async function makeKey(kid = 'test-kid'): Promise<KeyPair> {
  const pair = (await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify'],
  )) as CryptoKeyPair;
  const jwk = (await crypto.subtle.exportKey('jwk', pair.publicKey)) as JsonWebKey;
  return {
    privateKey: pair.privateKey,
    jwk: { ...jwk, kid, alg: 'RS256', use: 'sig' } as TestJwk,
  };
}

function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function encodeJson(value: unknown): string {
  return base64Url(new TextEncoder().encode(JSON.stringify(value)));
}

async function signJwt(
  payload: Record<string, unknown>,
  privateKey: CryptoKey,
  header: Record<string, unknown> = { alg: 'RS256', kid: 'test-kid' },
): Promise<string> {
  const headerPart = encodeJson(header);
  const payloadPart = encodeJson(payload);
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    privateKey,
    new TextEncoder().encode(`${headerPart}.${payloadPart}`),
  );
  return `${headerPart}.${payloadPart}.${base64Url(new Uint8Array(signature))}`;
}

function stubJwks(keys: JsonWebKey[] | TestJwk[]) {
  const stub = vi.fn(
    async () =>
      new Response(JSON.stringify({ keys }), { headers: { 'content-type': 'application/json' } }),
  );
  vi.stubGlobal('fetch', stub);
  return stub;
}

function payload(overrides: Record<string, unknown> = {}) {
  return {
    aud: [AUD],
    exp: Math.floor(Date.now() / 1000) + 3600,
    iss: TEAM,
    ...overrides,
  };
}

afterEach(() => {
  resetAccessKeyCache();
  vi.unstubAllGlobals();
});

describe('verifyAccessToken', () => {
  it('正しい JWT を通す', async () => {
    const key = await makeKey();
    stubJwks([key.jwk]);

    const token = await signJwt(payload(), key.privateKey);
    expect(await verifyAccessToken(token, { teamDomain: TEAM, aud: AUD })).toEqual({ ok: true });
  });

  it('aud が違えば拒否する', async () => {
    const key = await makeKey();
    stubJwks([key.jwk]);

    const token = await signJwt(payload({ aud: ['別のアプリ'] }), key.privateKey);
    const result = await verifyAccessToken(token, { teamDomain: TEAM, aud: AUD });
    expect(result).toMatchObject({ ok: false });
    expect(result.ok === false && result.reason).toMatch(/aud/);
  });

  it('有効期限が切れていれば拒否する', async () => {
    const key = await makeKey();
    stubJwks([key.jwk]);

    const token = await signJwt(payload({ exp: 1 }), key.privateKey);
    const result = await verifyAccessToken(token, { teamDomain: TEAM, aud: AUD });
    expect(result.ok === false && result.reason).toMatch(/有効期限/);
  });

  it('別の鍵で署名されていれば拒否する（ヘッダーの偽装対策）', async () => {
    const real = await makeKey();
    const attacker = await makeKey();
    stubJwks([real.jwk]);

    const token = await signJwt(payload(), attacker.privateKey);
    const result = await verifyAccessToken(token, { teamDomain: TEAM, aud: AUD });
    expect(result.ok === false && result.reason).toMatch(/署名/);
  });

  it('alg が RS256 でなければ拒否する', async () => {
    const key = await makeKey();
    stubJwks([key.jwk]);

    const token = await signJwt(payload(), key.privateKey, { alg: 'none', kid: 'test-kid' });
    const result = await verifyAccessToken(token, { teamDomain: TEAM, aud: AUD });
    expect(result.ok === false && result.reason).toMatch(/alg/);
  });

  it('kid に対応する公開鍵が無ければ拒否する', async () => {
    const key = await makeKey('known-kid');
    stubJwks([key.jwk]);

    const token = await signJwt(payload(), key.privateKey, { alg: 'RS256', kid: 'unknown-kid' });
    const result = await verifyAccessToken(token, { teamDomain: TEAM, aud: AUD });
    expect(result.ok === false && result.reason).toMatch(/kid/);
  });

  it('公開鍵を取得できなければ拒否する（例外は投げない）', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 500 })));

    const key = await makeKey();
    const token = await signJwt(payload(), key.privateKey);
    const result = await verifyAccessToken(token, { teamDomain: TEAM, aud: AUD });
    expect(result.ok === false && result.reason).toMatch(/公開鍵/);
  });

  it('JWT の形が不正なら拒否する', async () => {
    expect(await verifyAccessToken('not-a-jwt', { teamDomain: TEAM, aud: AUD })).toMatchObject({
      ok: false,
    });
    expect(await verifyAccessToken('a.b', { teamDomain: TEAM, aud: AUD })).toMatchObject({ ok: false });
  });

  it('公開鍵はキャッシュする（毎回取りに行かない）', async () => {
    const key = await makeKey();
    const stub = stubJwks([key.jwk]);
    const token = await signJwt(payload(), key.privateKey);

    await verifyAccessToken(token, { teamDomain: TEAM, aud: AUD });
    await verifyAccessToken(token, { teamDomain: TEAM, aud: AUD });

    expect(stub).toHaveBeenCalledTimes(1);
  });
});
