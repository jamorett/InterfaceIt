import { Children, isValidElement, memo, type ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { CodeBlock } from '../components/CodeBlock.tsx';
import { strings } from '../strings.ts';
import { closeOpenFence, safeHref } from './markdown.ts';

const textOf = (node: ReactNode): string =>
  Children.toArray(node).map((c) => (typeof c === 'string' || typeof c === 'number' ? String(c) : isValidElement<{ children?: ReactNode }>(c) ? textOf(c.props.children) : '')).join('');

function codeOf(children: ReactNode): { code: string; language?: string } {
  const el = Children.toArray(children)[0];
  const props = isValidElement<{ className?: string; children?: ReactNode }>(el) ? el.props : {};
  return { code: textOf(props.children).replace(/\n$/, ''), language: /language-([\w-]+)/.exec(props.className ?? '')?.[1] };
}

const makeComponents = (streaming: boolean): Components => ({
  pre: ({ children }) => <CodeBlock {...codeOf(children)} streaming={streaming} />,
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
});

// one set while text is streaming, one when it is final (code is only highlighted in the final one)
const whileStreaming = makeComponents(true);
const final = makeComponents(false);

/** Claude's answer as formatted text. No raw HTML is ever rendered (react-markdown's default), links are filtered, images are not loaded. */
export const Markdown = memo(function Markdown({ text, streaming = false }: { text: string; streaming?: boolean }) {
  return (
    <div dir="auto" className={`md ${streaming ? 'md-streaming' : ''}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={streaming ? whileStreaming : final} urlTransform={(u) => safeHref(u) ?? ''}>
        {streaming ? closeOpenFence(text) : text}
      </ReactMarkdown>
    </div>
  );
});
