#!/usr/bin/env node
/**
 * `.well-known/site.standard.publication` を config.json から生成する。
 * AT-URI の二重管理を避けるため、このファイルは Git 管理しない（.gitignore 済み）。
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const config = JSON.parse(
  readFileSync(join(root, '../packages/shared/config.json'), 'utf8'),
);

const atUri = config.publicationAtUri;
const target = join(root, 'public/.well-known/site.standard.publication');

mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, `${atUri}\n`, 'utf8');

if (atUri.includes('REPLACE_ME')) {
  console.warn(
    '[gen-verification] publicationAtUri がプレースホルダのままです。' +
      ' atproto:bootstrap を実行して config.json を更新してください。',
  );
}

console.log(`[gen-verification] ${target} <- ${atUri}`);
