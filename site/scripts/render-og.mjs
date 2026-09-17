#!/usr/bin/env node
/**
 * OGP の既定画像（1200x630）を生成する。デザインはこのスクリプトが唯一のソースで、
 * 出力 `public/og-default.png` はコミットする。実行は手動（npm run og -w site）。
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

const WIDTH = 1200;
const HEIGHT = 630;
const FONT = 'WenQuanYi Zen Hei, Noto Sans CJK JP, Liberation Sans, DejaVu Sans, sans-serif';

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${rgb(accent)}"/>
      <stop offset="100%" stop-color="#0b1220"/>
    </linearGradient>
  </defs>
  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#bg)"/>
  <circle cx="${WIDTH - 90}" cy="${HEIGHT - 70}" r="210" fill="#ffffff" opacity="0.05"/>
  <circle cx="80" cy="60" r="140" fill="#ffffff" opacity="0.04"/>
  <g font-family="${FONT}" fill="#ffffff">
    <text x="80" y="300" font-size="96" font-weight="700">${escape(config.name)}</text>
    <text x="80" y="376" font-size="34" opacity="0.85">${escape(config.description)}</text>
    <text x="80" y="${HEIGHT - 72}" font-size="26" opacity="0.7">${escape(new URL(config.siteUrl).host)}</text>
  </g>
  <rect x="80" y="410" width="112" height="8" rx="4" fill="${rgb(foreground)}" opacity="0.9"/>
</svg>`;

const output = join(root, 'public/og-default.png');
await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toFile(output);
console.log(`[render-og] ${output}`);
