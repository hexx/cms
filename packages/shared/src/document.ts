import { SITE_URL } from './config.ts';

export type DocumentKind = 'post' | 'note';

export const DOCUMENT_KINDS: readonly DocumentKind[] = ['post', 'note'] as const;

/** URL のディレクトリ名。URL は `/posts/YYYY/MM/<slug>` / `/notes/YYYY/MM/<slug>` */
export const KIND_DIRECTORY: Record<DocumentKind, string> = {
  post: 'posts',
  note: 'notes',
};

/**
 * 日付を **JST のカレンダー**で分解する。
 * ビルド環境のタイムゾーンに依存せず URL を安定させるために必要。
 */
export function jstParts(date: Date): { year: string; month: string; day: string } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const pick = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return { year: pick('year'), month: pick('month'), day: pick('day') };
}

/** Canonical URL のパス部分（例: /posts/2026/09/hello-world） */
export function documentPath(kind: DocumentKind, publishedAt: Date, slug: string): string {
  const { year, month } = jstParts(publishedAt);
  return `/${KIND_DIRECTORY[kind]}/${year}/${month}/${slug}`;
}

/** Canonical URL（正典の絶対 URL） */
export function canonicalUrl(path: string): string {
  return `${SITE_URL}${path.startsWith('/') ? path : `/${path}`}`;
}

/** Delivery やレコード対応で使う安定 ID（例: post:hello-world） */
export function documentId(kind: DocumentKind, slug: string): string {
  return `${kind}:${slug}`;
}

/**
 * Document Record の AT-URI を組み立てる。
 * publication の AT-URI（at://<did>/site.standard.publication/<rkey>）の authority を流用する。
 */
export function documentAtUri(publicationAtUri: string, slug: string): string {
  const authority = publicationAtUri.replace(/^at:\/\//, '').split('/')[0];
  return `at://${authority}/site.standard.document/${slug}`;
}

/** 公開日時の表示用フォーマット（JST） */
export function formatJstDate(date: Date): string {
  const { year, month, day } = jstParts(date);
  return `${year}-${month}-${day}`;
}
