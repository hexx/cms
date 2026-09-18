import { getCollection, type CollectionEntry } from 'astro:content';
import {
  canonicalUrl,
  contentHash,
  documentId,
  documentPath,
  jstParts,
  type DocumentFrontmatter,
  type DocumentKind,
} from '@hexx/shared';
import { markdownToText } from './markdown.ts';

export type AnyEntry = CollectionEntry<'posts'> | CollectionEntry<'notes'>;

export type Document = {
  kind: DocumentKind;
  slug: string;
  /** 安定 ID（例: post:hello-world） */
  id: string;
  title: string;
  description?: string;
  tags: string[];
  coverImage?: string;
  publishedAt: Date;
  updatedAt?: Date;
  lang: string;
  draft: boolean;
  year: string;
  month: string;
  /** Canonical URL のパス（例: /posts/2026/09/hello-world） */
  path: string;
  /** Canonical URL（絶対） */
  url: string;
  /** 本文のプレーンテキスト。standard.site の textContent と SNS 配信に使う */
  textContent: string;
  /** 内容ハッシュ。Syndicator の差分検出に使う */
  hash: string;
  entry: AnyEntry;
};

async function toDocument(kind: DocumentKind, entry: AnyEntry): Promise<Document> {
  const data = entry.data as DocumentFrontmatter;
  const slug = entry.id;
  const body = (entry as { body?: string }).body ?? '';
  const path = documentPath(kind, data.publishedAt, slug);
  const tags = data.tags ?? [];
  const textContent = markdownToText(body);
  const hash = await contentHash({
    kind,
    slug,
    path,
    title: data.title,
    description: data.description ?? null,
    tags,
    coverImage: data.coverImage ?? null,
    publishedAt: data.publishedAt.toISOString(),
    updatedAt: data.updatedAt?.toISOString() ?? null,
    textContent,
  });

  return {
    kind,
    slug,
    id: documentId(kind, slug),
    title: data.title,
    description: data.description,
    tags,
    coverImage: data.coverImage,
    publishedAt: data.publishedAt,
    updatedAt: data.updatedAt,
    lang: data.lang,
    draft: data.draft,
    ...jstParts(data.publishedAt),
    path,
    url: canonicalUrl(path),
    textContent,
    hash,
    entry,
  };
}

/** 下書きを含む全 Document（公開日の降順） */
export async function getAllDocuments(): Promise<Document[]> {
  const [posts, notes] = await Promise.all([getCollection('posts'), getCollection('notes')]);
  const documents = await Promise.all([
    ...posts.map((entry) => toDocument('post', entry)),
    ...notes.map((entry) => toDocument('note', entry)),
  ]);
  return documents.sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime());
}

/**
 * 公開済みの Document（公開日の降順）。
 * 1回のビルドで全ページから呼ばれるため、Markdown の解析とハッシュ計算は
 * 最初の1回だけにして結果を使い回す。
 */
let publishedCache: Promise<Document[]> | null = null;

export async function getPublishedDocuments(): Promise<Document[]> {
  publishedCache ??= getAllDocuments().then((documents) => documents.filter((doc) => !doc.draft));
  return publishedCache;
}

export function filterByKind(documents: Document[], kind: DocumentKind): Document[] {
  return documents.filter((doc) => doc.kind === kind);
}

export type TagCount = { tag: string; count: number };

export function collectTags(documents: Document[]): TagCount[] {
  const counts = new Map<string, number>();
  for (const doc of documents) {
    for (const tag of doc.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, 'ja'));
}
