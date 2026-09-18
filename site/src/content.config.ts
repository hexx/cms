import { glob } from 'astro/loaders';
import { defineCollection } from 'astro:content';
import { documentFrontmatterSchema } from '@hexx/shared';

const posts = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/posts' }),
  schema: documentFrontmatterSchema,
});

const notes = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/notes' }),
  schema: documentFrontmatterSchema,
});

export const collections = { posts, notes };
