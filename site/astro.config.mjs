import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'astro/config';

// astro.config はビルドより前に読まれるため、JSON は素直に読み込む
const config = JSON.parse(
  readFileSync(fileURLToPath(new URL('../packages/shared/config.json', import.meta.url)), 'utf8'),
);

export default defineConfig({
  site: config.siteUrl,
  trailingSlash: 'never',
  build: { format: 'directory' },
  markdown: {
    shikiConfig: {
      themes: { light: 'github-light', dark: 'github-dark' },
      wrap: true,
    },
  },
  vite: {
    ssr: { noExternal: ['@hexx/shared'] },
  },
});
