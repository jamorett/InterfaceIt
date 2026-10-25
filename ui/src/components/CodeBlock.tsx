import { Check, Copy } from 'lucide-react';
import { Fragment, useEffect, useState } from 'react';
import type { Tokens } from '../transcript/highlight.ts';
import { strings } from '../strings.ts';

function Highlighted({ tokens }: { tokens: Tokens }) {
  return (
    <>
      {tokens.map((line, i) => (
        <Fragment key={i}>
          {line.map((t, j) => {
            const f = t.fontStyle ?? 0;
            return (
              <span key={j} style={{ color: t.color, fontStyle: f & 1 ? 'italic' : undefined, fontWeight: f & 2 ? 600 : undefined, textDecoration: f & 4 ? 'underline' : undefined }}>
                {t.content}
              </span>
            );
          })}
          {i < tokens.length - 1 ? '\n' : ''}
        </Fragment>
      ))}
    </>
  );
}

/**
 * A block of code: monospace, scrolls sideways inside itself, copy button, and syntax colours once the highlighter has loaded.
 * While the text is still streaming it stays plain (re-highlighting every frame would cost more than it helps).
 */
export function CodeBlock({ code, language, streaming = false, className = '' }: { code: string; language?: string; streaming?: boolean; className?: string }) {
  const [copied, setCopied] = useState(false);
  const [tokens, setTokens] = useState<Tokens>();

  useEffect(() => {
    setTokens(undefined);
    if (streaming || !language) return;
    let live = true;
    import('../transcript/highlight.ts')
      .then((m) => m.highlight(code, language))
      .then((t) => { if (live) setTokens(t); })
      .catch(() => undefined); // the chunk could not load: the plain text stays
    return () => { live = false; };
  }, [code, language, streaming]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard blocked: the text is still selectable */ }
  };

  return (
    <div className={`my-2 rounded-control border border-line bg-well ${className}`}>
      <div className="flex items-center justify-between px-3 pt-1 text-xs text-muted">
        <span>{language ?? ''}</span>
        <button type="button" onClick={copy} className="press -mr-1 inline-flex items-center gap-1 rounded-control px-1.5 py-0.5 hover:bg-card pointer-coarse:min-h-11">
          {copied ? <Check aria-hidden className="size-3.5" /> : <Copy aria-hidden className="size-3.5" />}
          {copied ? strings.markdown.copied : strings.markdown.copy}
        </button>
      </div>
      <pre tabIndex={0} aria-label={language ? `${language} code` : 'Code'} className="overflow-x-auto px-3 pt-1 pb-3 font-mono text-sm leading-snug whitespace-pre text-ink">
        <code>{tokens ? <Highlighted tokens={tokens} /> : code}</code>
      </pre>
    </div>
  );
}
