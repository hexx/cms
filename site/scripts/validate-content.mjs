#!/usr/bin/env node
/**
 * ビルド前のコンテンツ検証。
 *
 * - frontmatter が zod スキーマを満たすか（Astro も検証するが、失敗を早く・読みやすく出す）
 * - slug が Post / Note をまたいで一意か（Document Record の rkey と URL の同一性を守る）
 * - `publishedAt` が未来でないか（予約投稿はスコープ外）
 * - `.well-known/site.standard.publication` が config と一致しているか
 * - `global.css` の配色トークンが config の `basicTheme` と一致しているか（ADR-0012）
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
      CONFIG: shared.CONFIG,
    };
  } catch (error) {
    console.error(`[validate-content] 依存パッケージを読み込めません: ${error.message}`);
    console.error('  `npm install` を実行してください。');
    console.error('  NODE_ENV=production のままだと devDependencies が入らず、ビルドも通らなくなります。');
    process.exit(1);
  }
}

const { parseYaml, documentFrontmatterSchema, documentPath, PUBLICATION_AT_URI, CONFIG } =
  await loadDependencies();

const errors = [];
const warnings = [];

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---/;

const collections = [
  { kind: 'post', dir: join(root, 'src/content/posts') },
  { kind: 'note', dir: join(root, 'src/content/notes') },
];

/** 配色の対応。publication の basicTheme と一対一で揃える（ADR-0012） */
const BASIC_THEME_TOKENS = [
  ['--bg', 'background'],
  ['--fg', 'foreground'],
  ['--accent', 'accent'],
  ['--accent-fg', 'accentForeground'],
];

const globalCssPath = join(root, 'src/styles/global.css');

/** global.css の最初の `:root` ブロック（＝ライトの定義）の宣言を読む。読めなければ null */
function parseRootTokens(css) {
  // セレクタに `:root` を含むトップレベルの規則だけを拾う（ダークは @media の中なので当たらない）
  const block = css.match(/(?:^|})\s*:root\s*\{([^{}]*)\}/);
  return block ? parseDeclarations(block[1]) : null;
}

/** `a: b; c: d` を Map にする */
function parseDeclarations(body) {
  const declarations = new Map();
  for (const declaration of body.split(';')) {
    const separator = declaration.indexOf(':');
    if (separator === -1) continue;
    const name = declaration.slice(0, separator).trim();
    if (name) declarations.set(name, declaration.slice(separator + 1).trim());
  }
  return declarations;
}

/** 宣言の順番に依存せず比較するための文字列化 */
function serialize(declarations) {
  return [...declarations]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, value]) => `${name}:${value}`)
    .join('\n');
}

function hexToRgb(hex) {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!match) return null;
  const value = Number.parseInt(match[1], 16);
  return { r: (value >> 16) & 0xff, g: (value >> 8) & 0xff, b: value & 0xff };
}

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

// 配色トークンと publication の basicTheme の一致（ADR-0012）。
// レコードには色が焼き込まれていて変更には putRecord が要るので、ずれはここで止める。
if (!existsSync(globalCssPath)) {
  errors.push(`global.css がありません: ${globalCssPath}`);
} else {
  const css = readFileSync(globalCssPath, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const tokens = parseRootTokens(css);
  if (!tokens) {
    errors.push('global.css から :root ブロック（ライトの配色）を読み出せません');
  } else {
    for (const [token, key] of BASIC_THEME_TOKENS) {
      const hex = tokens.get(token);
      if (!hex) {
        errors.push(`global.css の :root に ${token} がありません`);
        continue;
      }
      const rgb = hexToRgb(hex);
      if (!rgb) {
        errors.push(`global.css の ${token} を色として読めません: ${hex}`);
        continue;
      }
      const expected = CONFIG.basicTheme[key];
      if (rgb.r !== expected.r || rgb.g !== expected.g || rgb.b !== expected.b) {
        errors.push(
          `global.css の ${token} が basicTheme.${key} と一致しません（${hex} != rgb(${expected.r},${expected.g},${expected.b})）。publication record には色が焼き込まれています`,
        );
      }
    }
  }

  // ダークの値は「自動（OS に追従）」と「明示（data-theme=dark）」の2箇所にある。
  // 片方だけ直すと「OS がダークのとき」と「トグルでダークにしたとき」で見た目がずれる。
  const autoDark = css.match(
    /@media\s*\(prefers-color-scheme:\s*dark\)\s*\{\s*:root:not\(\[data-theme='light'\]\)\s*\{([^{}]*)\}/,
  );
  const forcedDark = css.match(/:root\[data-theme='dark'\]\s*\{([^{}]*)\}/);
  if (!autoDark || !forcedDark) {
    errors.push(
      'global.css にダークのトークンブロックが見つかりません（@media と :root[data-theme=dark] の両方が必要です）',
    );
  } else if (serialize(parseDeclarations(autoDark[1])) !== serialize(parseDeclarations(forcedDark[1]))) {
    errors.push(
      'global.css のダークのトークンが @media（自動）と :root[data-theme=dark]（明示）で一致しません',
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