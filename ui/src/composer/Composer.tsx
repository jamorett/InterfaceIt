import { ArrowUp, Square, X } from 'lucide-react';
import { useState, type KeyboardEvent } from 'react';
import { Button, IconButton } from '../components/Button.tsx';
import type { SessionState } from '../model.ts';
import { strings } from '../strings.ts';

type Props = {
  state: SessionState;
  queued?: string[];
  suggestion?: string;
  /** why typing is paused (limit reached, disconnected); the draft is kept */
  disabledReason?: string;
  initialDraft?: string;
  onSend?: (text: string) => void;
  onStop?: () => void;
  onRemoveQueued?: (index: number) => void;
};

const busy: SessionState[] = ['running', 'awaiting_permission', 'awaiting_answer', 'compacting', 'retrying'];

export function Composer({ state, queued = [], suggestion, disabledReason, initialDraft = '', onSend, onStop, onRemoveQueued }: Props) {
  const [text, setText] = useState(initialDraft);
  const running = busy.includes(state);
  const disabled = Boolean(disabledReason);

  const send = () => {
    if (!text.trim() || disabled) return;
    onSend?.(text.trim());
    setText('');
  };
  // Enter sends (queues while running), Shift+Enter is a newline, Tab takes the suggestion when the box is empty (PLAN.md §9.1)
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send();
    } else if (e.key === 'Tab' && !e.shiftKey && !text && suggestion) {
      e.preventDefault();
      setText(suggestion);
    }
  };

  return (
    <div className="@container border-t border-line bg-paper px-4 pt-2 pb-3">
      <div className="mx-auto w-full max-w-[780px]">
        {queued.length > 0 && (
          <ul aria-label={strings.composer.queued} className="mb-2 grid gap-1">
            {queued.map((q, i) => (
              <li key={i} className="enter flex items-center gap-2 rounded-control border border-dashed border-line px-2 py-1 text-sm text-muted">
                <span className="rounded-full bg-well px-2 text-xs">{strings.composer.queued}</span>
                <span className="min-w-0 flex-1 truncate">{q}</span>
                <IconButton label={strings.composer.removeQueued} onClick={() => onRemoveQueued?.(i)} className="size-6"><X aria-hidden className="size-3.5" /></IconButton>
              </li>
            ))}
          </ul>
        )}
        {suggestion && !text && !disabled && (
          <button type="button" onClick={() => setText(suggestion)} className="enter press mb-2 max-w-full truncate rounded-full border border-line bg-card px-3 py-1 text-sm text-accent hover:bg-well" title={strings.composer.suggestion}>
            {suggestion}
          </button>
        )}
        <div className={`flex flex-wrap items-end gap-2 rounded-card border bg-card p-2 ${disabled ? 'border-line' : 'border-line focus-within:border-accent'}`}>
          <label htmlFor="composer" className="sr-only">{strings.composer.label}</label>
          <textarea
            id="composer"
            rows={1}
            value={text}
            disabled={disabled}
            aria-describedby={disabled ? 'composer-why' : undefined}
            placeholder={strings.composer.placeholder}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKeyDown}
            className="max-h-[40dvh] min-h-9 min-w-0 flex-1 basis-full resize-none disabled:text-muted @md:basis-0 bg-transparent px-1 py-1.5 text-base [field-sizing:content] placeholder:text-muted focus:outline-none"
          />
          <div className="ml-auto flex gap-2">
          {running && (
            <Button variant="danger" onClick={onStop} aria-keyshortcuts="Escape">
              <Square aria-hidden className="size-3.5 fill-current" /> {strings.composer.stop}
            </Button>
          )}
          <Button variant="primary" onClick={send} disabled={disabled || !text.trim()} aria-label={strings.composer.send}>
            <ArrowUp aria-hidden className="size-4" /> {strings.composer.send}
          </Button>
          </div>
        </div>
        {disabled && <p id="composer-why" className="mt-1 text-sm text-muted">{disabledReason}</p>}
      </div>
    </div>
  );
}
