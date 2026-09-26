#!/usr/bin/env node
/**
 * ビルド前のコンテンツ検証。
 *
 * - frontmatter が zod スキーマを満たすか（Astro も検証するが、失敗を早く・読みやすく出す）
 * - slug が Post / Note をまたいで一意か（Document Record の rkey と URL の同一性を守る）
 * - `publishedAt` が未来でないか（予約投稿はスコープ外）
 * - `.well-known/site.standard.publication` が config と一致しているか
 *
 * 依存（yaml / @hexx/shared）は動的に読み込む。静的 import にすると
 * 「依存が入っていない」ときに解決エラーだけが出て原因が分かりにくいため。
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

async function loadDependencies() {
  try {
    const [yaml, shared] = await Promise.all([import('yaml'), import('@hexx/shared')]);
    return {
      parseYaml: yaml.parse,
      documentFrontmatterSchema: shared.documentFrontmatterSchema,
      documentPath: shared.documentPath,
      PUBLICATION_AT_URI: shared.PUBLICATION_AT_URI,
    };
  } catch (error) {
    console.error(`[validate-content] 依存パッケージを読み込めません: ${error.message}`);
    console.error('  `npm install` を実行してください。');
    console.error('  NODE_ENV=production のままだと devDependencies が入らず、ビルドも通らなくなります。');
    process.exit(1);
  }
}

const { parseYaml, documentFrontmatterSchema, documentPath, PUBLICATION_AT_URI } =
  await loadDependencies();

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

for (const { kind, dir } of collections) {
  if (!existsSync(dir)) continue;
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.md')).sort()) {
    const slug = file.replace(/\.md$/, '');
    const where = `${kind === 'post' ? 'posts' : 'notes'}/${file}`;
    count += 1;

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
    if (!raw || typeof raw.publishedAt === 'undefined') {
      errors.push(`${where}: publishedAt は必須です`);
    }
    if (data.publishedAt.getTime() > Date.now() + 60_000) {
      warnings.push(
        `${where}: publishedAt が未来です（${data.publishedAt.toISOString()}）。予約投稿はサポートしていません`,
      );
    }

    console.log(`  ok  ${where}  ->  ${documentPath(kind, data.publishedAt, slug)}`);
  }
}

// 検証ファイルと config の一致
const wellKnownPath = join(root, 'public/.well-known/site.standard.publication');
if (existsSync(wellKnownPath)) {
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