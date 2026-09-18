#!/usr/bin/env node
/**
 * ビルド前のコンテンツ検証。
 *
 * - frontmatter が zod スキーマを満たすか（Astro も検証するが、失敗を早く・読みやすく出す）
 * - slug が安全か（ATProto の rkey と URL の1セグメントになること）
 * - slug が Post / Note をまたいで一意か（rkey と URL の同一性を守る）
 * - publishedAt が未来でないか（予約投稿はスコープ外なので、未来日はミスとして止める）
 * - `.well-known/site.standard.publication` が config と一致しているか
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import {
  documentFrontmatterSchema,
  documentPath,
  isSafeSlug,
  PUBLICATION_AT_URI,
} from '@hexx/shared';

const root = fileURLToPath(new URL('..', import.meta.url));
const errors = [];
const warnings = [];

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---/;

const collections = [
  { kind: 'post', dir: join(root, 'src/content/posts') },
  { kind: 'note', dir: join(root, 'src/content/notes') },
];

/** @type {Map<string, string>} slug -> どこで使われたか */
const seenSlugs = new Map();
let count = 0;

/** base からの相対パスで Markdown を集める（Astro の glob と同じくネストも見る） */
function collectMarkdown(dir, base = dir) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...collectMarkdown(full, base));
    else if (entry.name.endsWith('.md')) found.push(relative(base, full).split(sep).join('/'));
  }
  return found.sort();
}

for (const { kind, dir } of collections) {
  if (!existsSync(dir)) continue;
  for (const file of collectMarkdown(dir)) {
    const slug = file.replace(/\.md$/, '');
    const where = `${kind === 'post' ? 'posts' : 'notes'}/${file}`;
    count += 1;

    if (!isSafeSlug(slug)) {
      errors.push(
        `${where}: slug は小文字英数字と . _ ~ - だけの1セグメントにしてください（ネストしたディレクトリは使えません）`,
      );
      continue;
    }

    const previous = seenSlugs.get(slug);
    if (previous) {
      errors.push(
        `slug が重複しています: ${slug}（${previous} と ${where}）。rkey と URL の同一性を守るため、slug は全体で一意にしてください`,
      );
    } else {
      seenSlugs.set(slug, where);
    }

    const source = readFileSync(join(dir, file), 'utf8');
    const match = source.match(FRONTMATTER_RE);
    if (!match) {
      errors.push(`${where}: frontmatter がありません`);
      continue;
    }

    let raw;
    try {
      raw = parseYaml(match[1]);
    } catch (error) {
      errors.push(`${where}: frontmatter の YAML を解析できません: ${error.message}`);
      continue;
    }

    const parsed = documentFrontmatterSchema.safeParse(raw);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        errors.push(`${where}: ${issue.path.join('.') || '(root)'} — ${issue.message}`);
      }
      continue;
    }

    const data = parsed.data;
    if (data.publishedAt.getTime() > Date.now() + 60_000) {
      errors.push(
        `${where}: publishedAt が未来です（${data.publishedAt.toISOString()}）。予約投稿はサポートしていないので、未来日はミスとして扱います`,
      );
      continue;
    }

    console.log(`  ok  ${where}  ->  ${documentPath(kind, data.publishedAt, slug)}`);
  }
}

// 検証ファイルと config の一致（gen-verification.mjs が先に走る前提）
const wellKnownPath = join(root, 'public/.well-known/site.standard.publication');
if (!existsSync(wellKnownPath)) {
  errors.push(
    'public/.well-known/site.standard.publication がありません。`npm run validate` は生成から行います（直接実行する場合は node scripts/gen-verification.mjs を先に）',
  );
} else {
  const actual = readFileSync(wellKnownPath, 'utf8').trim();
  if (actual !== PUBLICATION_AT_URI) {
    errors.push(
      `.well-known/site.standard.publication が config.json と一致しません（${actual} != ${PUBLICATION_AT_URI}）`,
    );
  }
}

if (PUBLICATION_AT_URI.includes('REPLACE_ME')) {
  warnings.push(
    'publicationAtUri がプレースホルダです。ATProto のブートストラップ後に config.json を更新してください',
  );
}

for (const warning of warnings) console.warn(`[warn] ${warning}`);
if (errors.length > 0) {
  console.error(`\n[validate-content] ${errors.length} 件のエラー:`);
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}

console.log(`[validate-content] ${count} 件の Document を検証しました`);
