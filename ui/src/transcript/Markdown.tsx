import { Check, Copy } from 'lucide-react';
import { Children, isValidElement, memo, useState, type ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { strings } from '../strings.ts';
import { closeOpenFence, safeHref } from './markdown.ts';

const textOf = (node: ReactNode): string =>
  Children.toArray(node).map((c) => (typeof c === 'string' || typeof c === 'number' ? String(c) : isValidElement<{ children?: ReactNode }>(c) ? textOf(c.props.children) : '')).join('');

function CodeBlock({ children }: { children?: ReactNode }) {
  const [copied, setCopied] = useState(false);
  const code = Children.toArray(children)[0];
  const props = isValidElement<{ className?: string; children?: ReactNode }>(code) ? code.props : {};
  const language = /language-([\w-]+)/.exec(props.className ?? '')?.[1];
  const text = textOf(props.children).replace(/\n$/, '');
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard blocked: the text is still selectable */ }
  };
  return (
    <div className="group relative my-2 rounded-control border border-line bg-well">
      <div className="flex items-center justify-between px-3 pt-1 text-xs text-muted">
        <span>{language ?? ''}</span>
        <button type="button" onClick={copy} className="press -mr-1 inline-flex items-center gap-1 rounded-control px-1.5 py-0.5 hover:bg-card pointer-coarse:min-h-11">
          {copied ? <Check aria-hidden className="size-3.5" /> : <Copy aria-hidden className="size-3.5" />}
          {copied ? strings.markdown.copied : strings.markdown.copy}
        </button>
      </div>
      <pre tabIndex={0} aria-label={language ? `${language} code` : 'Code'} className="overflow-x-auto px-3 pt-1 pb-3 font-mono text-sm leading-snug whitespace-pre text-ink">
        <code>{text}</code>
      </pre>
    </div>
  );
}

const components: Components = {
  pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
  code: ({ children }) => <code className="rounded-sm bg-well px-1 py-0.5 font-mono text-[0.92em] [overflow-wrap:anywhere]">{children}</code>,
  a: ({ href, children }) => {
    const safe = safeHref(href);
    return safe ? <a href={safe} target="_blank" rel="noreferrer noopener" className="text-accent underline underline-offset-2 [overflow-wrap:anywhere]">{children}</a> : <span>{children}</span>;
  },
  // remote images in model output would load without asking (a way to leak data or track): shown as text instead
  img: ({ alt }) => <span className="text-muted">[{alt || strings.markdown.image}]</span>,
  table: ({ children }) => (
    <div tabIndex={0} role="region" aria-label={strings.markdown.table} className="my-2 overflow-x-auto">
      <table className="w-full border-collapse text-left text-sm">{children}</table>
    </div>
  ),
  th: ({ children }) => <th className="border border-line bg-well px-2 py-1 font-semibold whitespace-nowrap">{children}</th>,
  td: ({ children }) => <td className="border border-line px-2 py-1 align-top">{children}</td>,
};

/** Claude's answer as formatted text. No raw HTML is ever rendered (react-markdown's default), links are filtered, images are not loaded. */
export const Markdown = memo(function Markdown({ text, streaming = false }: { text: string; streaming?: boolean }) {
  return (
    <div dir="auto" className={`md ${streaming ? 'md-streaming' : ''}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components} urlTransform={(u) => safeHref(u) ?? ''}>
        {streaming ? closeOpenFence(text) : text}
      </ReactMarkdown>
    </div>
  );
});
