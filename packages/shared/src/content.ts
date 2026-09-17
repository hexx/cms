import { z } from 'zod';
import { graphemeLength } from './grapheme.ts';

/** frontmatter の上限。standard.site の lexicon 制限より内側に置く */
export const LIMITS = {
  titleGraphemes: 200,
  descriptionGraphemes: 300,
  tags: 5,
  tagGraphemes: 64,
} as const;

const withinGraphemes = (max: number, label: string) =>
  z.string().refine((v) => graphemeLength(v) <= max, {
    message: `${label} は ${max} グラフェム以内にしてください`,
  });

/**
 * Post / Note の frontmatter。
 * slug はファイル名から与えられるため frontmatter には持たない。
 */
export const documentFrontmatterSchema = z
  .object({
    title: withinGraphemes(LIMITS.titleGraphemes, 'title'),
    publishedAt: z.coerce.date(),
    description: withinGraphemes(LIMITS.descriptionGraphemes, 'description').optional(),
    tags: z.array(withinGraphemes(LIMITS.tagGraphemes, 'tag')).max(LIMITS.tags).optional(),
    /** `site/public` 配下の絶対パス（例: /images/cover.png） */
    coverImage: z.string().refine((v) => v.startsWith('/'), {
      message: 'coverImage は / から始まる site/public 配下のパスにしてください',
    }).optional(),
    updatedAt: z.coerce.date().optional(),
    draft: z.boolean().default(false),
    lang: z.string().default('ja'),
  })
  .refine((v) => !v.updatedAt || v.updatedAt >= v.publishedAt, {
    message: 'updatedAt は publishedAt 以降の日時にしてください',
    path: ['updatedAt'],
  });

export type DocumentFrontmatter = z.infer<typeof documentFrontmatterSchema>;
