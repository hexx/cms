import { fromMarkdown } from 'mdast-util-from-markdown';

/** mdast ノードの最小形（型パッケージへの依存を避けるため自前で定義する） */
type MdNode = {
  type: string;
  value?: string;
  url?: string;
  alt?: string | null;
  children?: MdNode[];
};

/**
 * Markdown をプレーンテキストにする。
 * standard.site の `textContent` と、Note を SNS へそのまま流すときの本文に使う。
 *
 * - 装飾（強調・コード・見出し記号）は落とす
 * - リンクは表示テキストを残し、URL と異なる場合のみ `<url>` を添える
 * - 画像は alt を残す
 */
export function markdownToText(markdown: string): string {
  const tree = fromMarkdown(markdown) as unknown as MdNode;
  const text = (tree.children ?? []).map(nodeToText).join('');
  return normalize(text);
}

function nodeToText(node: MdNode): string {
  switch (node.type) {
    case 'text':
      return node.value ?? '';
    case 'inlineCode':
      return node.value ?? '';
    case 'code':
      return `${node.value ?? ''}\n\n`;
    case 'image':
      return node.alt ?? '';
    case 'html':
    case 'definition':
    case 'thematicBreak':
      return '';
    case 'break':
      return '\n';
    case 'link': {
      const label = (node.children ?? []).map(nodeToText).join('');
      const url = node.url ?? '';
      if (!url || label === url) return label || url;
      return `${label} <${url}>`;
    }
    case 'paragraph':
    case 'heading':
    case 'blockquote':
    case 'footnoteDefinition':
      return `${(node.children ?? []).map(nodeToText).join('')}\n\n`;
    case 'listItem':
      return (node.children ?? []).map(nodeToText).join('');
    case 'list':
      return `${(node.children ?? [])
        .map((item) => `- ${nodeToText(item).trim()}`)
        .join('\n')}\n\n`;
    default:
      return (node.children ?? []).map(nodeToText).join('');
  }
}

function normalize(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
