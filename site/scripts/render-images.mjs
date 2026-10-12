#!/usr/bin/env node
/**
 * OGP の既定画像と publication のアイコンを生成する。
 * デザインは favicon.svg を唯一のソースとし、PNG は生成物としてコミットする。
 * 実行は手動（npm run images -w site）。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = fileURLToPath(new URL('..', import.meta.url));
const config = JSON.parse(readFileSync(join(root, '../packages/shared/config.json'), 'utf8'));
const { accent, foreground } = config.basicTheme;
const rgb = (c) => `rgb(${c.r},${c.g},${c.b})`;
const escape = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const FONT = 'WenQuanYi Zen Hei, Noto Sans CJK JP, Liberation Sans, DejaVu Sans, sans-serif';
const globalCss = readFileSync(join(root, 'src/styles/global.css'), 'utf8');

// 紙面トーンの階調は global.css から読む（重複させると配色の変更で OG 画像が古くなる）
const token = (name) => {
  const match = new RegExp(`${name}:\\s*(#[0-9a-f]{6})`, 'i').exec(globalCss);
  if (!match) throw new Error(`global.css の :root に ${name} がありません`);
  return match[1];
};

const PAPER = token('--bg-subtle');
const MUTED = token('--fg-muted');
const RULE = token('--line-strong');

// 1. OGP 既定画像（1200x630）— 派手な色を使わず、小さなアクセントだけ置く（docs/spec.md §8.4.2）
{
  const width = 1200;
  const height = 630;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="${PAPER}"/>
  <rect width="${width}" height="8" fill="${rgb(accent)}"/>
  <rect x="96" y="318" width="64" height="4" rx="2" fill="${RULE}"/>
  <g font-family="${FONT}">
    <text x="96" y="290" font-size="88" font-weight="600" fill="${rgb(foreground)}">${escape(config.name)}</text>
    <text x="96" y="390" font-size="32" fill="${MUTED}">${escape(config.description)}</text>
  </g>
</svg>`;
  const output = join(root, 'public/og-default.png');
  await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toFile(output);
  console.log(`[render-images] ${output}`);
}

// 2. publication のアイコン（512x512、favicon.svg から）
{
  const source = readFileSync(join(root, 'public/favicon.svg'), 'utf8');
  const sized = source.replace(
    '<svg ',
    '<svg width="512" height="512" ',
  );
  const output = join(root, 'public/icon-512.png');
  await sharp(Buffer.from(sized)).resize(512, 512).png({ compressionLevel: 9 }).toFile(output);
  console.log(`[render-images] ${output}`);
}
