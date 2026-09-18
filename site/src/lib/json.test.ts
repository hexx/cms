import { describe, expect, it } from 'vitest';
import { toJsonLd } from './json.ts';

describe('toJsonLd', () => {
  it('通常の JSON はそのまま出す', () => {
    expect(toJsonLd({ '@type': 'BlogPosting', headline: 'タイトル' })).toBe(
      '{"@type":"BlogPosting","headline":"タイトル"}',
    );
  });

  it('</script> で抜けられないよう < をエスケープする', () => {
    const text = toJsonLd({ headline: '</script><img src=x onerror=alert(1)>' });
    expect(text).not.toContain('<');
    expect(text).toContain('\\u003c/script>');
    // JSON としては壊れていない
    expect(JSON.parse(text)).toEqual({ headline: '</script><img src=x onerror=alert(1)>' });
  });
});
