#!/usr/bin/env node
/**
 * publication レコードを作成し、AT-URI を config.json に書き戻す。
 *
 * ローカルに App Password を置かずに済むよう、Syndicator が持つ資格情報で
 * Worker 側に書いてもらう（POST /v1/publication）。
 *
 *   SYNDICATOR_URL=https://syndicator.hexx.jp ADMIN_TOKEN=... npm run bootstrap -w syndicator -- --write
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const url = process.env.SYNDICATOR_URL;
const token = process.env.ADMIN_TOKEN;

if (!url || !token) {
  console.error('SYNDICATOR_URL と ADMIN_TOKEN を環境変数で渡してください。');
  console.error('例: SYNDICATOR_URL=https://syndicator.hexx.jp ADMIN_TOKEN=xxx npm run bootstrap');
  process.exit(1);
}

const response = await fetch(`${url.replace(/\/+$/, '')}/v1/publication`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}` },
});

const body = await response.json();
if (!response.ok) {
  console.error('publication レコードの作成に失敗しました:', body);
  process.exit(1);
}

const atUri = body.atUri;
const did = String(atUri).replace(/^at:\/\//, '').split('/')[0];

console.log(`publication AT-URI : ${atUri}`);
console.log(`Bluesky ハンドル用 : _atproto.hexx.jp TXT "did=${did}"`);

const configPath = fileURLToPath(new URL('../../packages/shared/config.json', import.meta.url));
const config = JSON.parse(readFileSync(configPath, 'utf8'));

if (config.publicationAtUri === atUri) {
  console.log('config.json の publicationAtUri は既に最新です。');
  process.exit(0);
}

if (process.argv.includes('--write')) {
  config.publicationAtUri = atUri;
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  console.log('config.json の publicationAtUri を更新しました。コミットしてデプロイしてください。');
} else {
  console.log(
    `config.json の publicationAtUri を ${atUri} に更新してください（--write を付けると自動で書き換えます）。`,
  );
}
