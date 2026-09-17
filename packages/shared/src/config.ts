import rawConfig from '../config.json' with { type: 'json' };

export type Rgb = { r: number; g: number; b: number };

export type SiteConfig = {
  /** 正典のオリジン。末尾スラッシュなしで扱う */
  siteUrl: string;
  /** Publication 名（standard.site の publication.name にも使う） */
  name: string;
  /** ブログの説明（publication.description / meta description にも使う） */
  description: string;
  language: string;
  author: { name: string; url: string };
  /** rel="me" で並べる本人確認リンク */
  relMe: string[];
  /** standard.site の publication レコードの AT-URI。ブートストラップで確定させる */
  publicationAtUri: string;
  /** standard.site の basicTheme にそのまま流用する配色 */
  basicTheme: {
    background: Rgb;
    foreground: Rgb;
    accent: Rgb;
    accentForeground: Rgb;
  };
  defaultOgImage: string;
  webmentionEndpoint: string;
  /** フィードに載せる最大件数 */
  feedLimit: number;
};

export const CONFIG = rawConfig as SiteConfig;

/** 末尾スラッシュを除いたサイト URL */
export const SITE_URL = CONFIG.siteUrl.replace(/\/+$/, '');

/** standard.site の publication レコードの AT-URI */
export const PUBLICATION_AT_URI = CONFIG.publicationAtUri;

/** ブートストラップ前のプレースホルダのままかどうか */
export const IS_PLACEHOLDER_PUBLICATION = PUBLICATION_AT_URI.includes('REPLACE_ME');

export const SITE_NAME = CONFIG.name;
export const SITE_DESCRIPTION = CONFIG.description;
export const SITE_LANGUAGE = CONFIG.language;
export const DEFAULT_OG_IMAGE = CONFIG.defaultOgImage;
export const WEBMENTION_ENDPOINT = CONFIG.webmentionEndpoint;

/** サイト内の相対パスを絶対 URL にする。すでに絶対 URL ならそのまま返す */
export function absoluteUrl(pathOrUrl: string): string {
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  return `${SITE_URL}${pathOrUrl.startsWith('/') ? '' : '/'}${pathOrUrl}`;
}
