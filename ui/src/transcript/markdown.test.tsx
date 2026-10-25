import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Markdown } from './Markdown.tsx';
import { closeOpenFence, safeHref } from './markdown.ts';

const html = (text: string, streaming = false) => renderToStaticMarkup(<Markdown text={text} streaming={streaming} />);

describe('closeOpenFence', () => {
  it('closes a fence that is still open', () => {
    expect(closeOpenFence('Here:\n```ts\nconst a = 1;')).toBe('Here:\n```ts\nconst a = 1;\n```');
    expect(closeOpenFence('~~~\ncode\n')).toBe('~~~\ncode\n~~~');
  });
  it('leaves finished and fence-free text alone', () => {
    expect(closeOpenFence('```\ncode\n```\nafter')).toBe('```\ncode\n```\nafter');
    expect(closeOpenFence('no code here, just `inline`')).toBe('no code here, just `inline`');
    expect(closeOpenFence('')).toBe('');
  });
  it('handles a second block opened after the first closed, and longer fences', () => {
    expect(closeOpenFence('```\na\n```\n\n```py\nb')).toMatch(/```py\nb\n```$/);
    expect(closeOpenFence('````\n```\ninside\n````')).toBe('````\n```\ninside\n````'); // a ``` inside a ```` block is just text
  });
});

describe('safeHref', () => {
  it('allows web, mail, anchors and absolute paths only', () => {
    for (const ok of ['https://a.dev/x', 'http://a.dev', 'mailto:me@a.dev', '#section', '/docs']) expect(safeHref(ok)).toBe(ok);
    for (const bad of ['javascript:alert(1)', ' JavaScript:alert(1)', 'data:text/html,<b>', 'file:///C:/secret.txt', '//evil.example/x', 'vbscript:x', '', undefined]) expect(safeHref(bad)).toBeUndefined();
  });
});

describe('Markdown', () => {
  it('formats headings, lists, tables, emphasis and code', () => {
    const out = html('# Title\n\n- one\n- two\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n**bold** and `code`\n\n```ts\nconst x = 1;\n```');
    expect(out).toContain('<h1');
    expect(out).toContain('<ul');
    expect(out).toContain('<table');
    expect(out).toContain('role="region"'); // a wide table scrolls inside a focusable region
    expect(out).toContain('<strong>bold</strong>');
    expect(out).toMatch(/<pre[^>]*tabindex="0"/); // a scrollable code block is reachable by keyboard
    expect(out).toContain('aria-label="ts code"');
    expect(out).toContain('const x = 1;');
  });

  it('never renders raw HTML from the model', () => {
    const out = html('<script>alert(1)</script><img src=x onerror=alert(1)><iframe src="https://evil.example"></iframe>\n\n<b onclick="x()">hi</b>');
    // the text may appear, escaped; what must never exist is an element
    for (const bad of ['<script', '<img', '<iframe']) expect(out).not.toContain(bad);
    expect(out).not.toMatch(/<[a-z][^>]*\son\w+\s*=/i); // no real tag carries an event handler
    expect(out).toContain('&lt;script&gt;');
  });

  it('drops links that could run code or read local files, and opens real ones safely', () => {
    const out = html('[bad](javascript:alert(1)) [file](file:///C:/x) [ok](https://example.com)');
    expect(out).not.toContain('javascript:');
    expect(out).not.toContain('file:///');
    expect(out).toContain('href="https://example.com"');
    expect(out).toContain('rel="noreferrer noopener"');
    expect(out).toContain('target="_blank"');
  });

  it('does not load remote images (they could leak data); the alt text is shown instead', () => {
    const out = html('![diagram](https://tracker.example/pixel.png?u=secret)');
    expect(out).not.toContain('<img');
    expect(out).not.toContain('tracker.example');
    expect(out).toContain('[diagram]');
  });

  it('shows a half-written code fence as a code block while streaming', () => {
    expect(html('Look:\n```js\nlet a = 1', true)).toContain('let a = 1');
    expect(html('Look:\n```js\nlet a = 1', true)).toContain('<pre');
  });

  it('copes with empty, huge and hostile text', () => {
    expect(() => html('')).not.toThrow();
    expect(() => html('x'.repeat(200_000))).not.toThrow();
    expect(() => html('[' .repeat(5000) + '](' .repeat(5000))).not.toThrow();
    expect(() => html('\u0000\u202e RTL \ud800 broken surrogate')).not.toThrow();
  });
});
