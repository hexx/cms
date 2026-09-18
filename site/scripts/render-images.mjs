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

// 1. OGP 既定画像（1200x630）
{
  const width = 1200;
  const height = 630;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${rgb(accent)}"/>
      <stop offset="100%" stop-color="#0b1220"/>
    </linearGradient>
  </defs>
  <rect width="${width}" height="${height}" fill="url(#bg)"/>
  <circle cx="${width - 90}" cy="${height - 70}" r="210" fill="#ffffff" opacity="0.05"/>
  <circle cx="80" cy="60" r="140" fill="#ffffff" opacity="0.04"/>
  <g font-family="${FONT}" fill="#ffffff">
    <text x="80" y="300" font-size="96" font-weight="700">${escape(config.name)}</text>
    <text x="80" y="376" font-size="34" opacity="0.85">${escape(config.description)}</text>
    <text x="80" y="${height - 72}" font-size="26" opacity="0.7">${escape(new URL(config.siteUrl).host)}</text>
  </g>
  <rect x="80" y="410" width="112" height="8" rx="4" fill="${rgb(foreground)}" opacity="0.9"/>
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
