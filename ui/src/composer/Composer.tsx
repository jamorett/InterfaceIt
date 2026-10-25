import { ArrowUp, ImagePlus, Square, X } from 'lucide-react';
import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent } from 'react';
import { Button, IconButton } from '../components/Button.tsx';
import type { SessionState } from '../model.ts';
import { imageSrc } from '../state/describe.ts';
import { strings } from '../strings.ts';
import { isImage, readImage, type Attached } from './images.ts';
import { complete, MAX_IMAGES, matchCommands, triggerAt } from './triggers.ts';

type Props = {
  state: SessionState;
  queued?: string[];
  suggestion?: string;
  /** why typing is paused (limit reached, disconnected); the draft is kept */
  disabledReason?: string;
  initialDraft?: string;
  commands?: { name: string; description?: string; hint?: string }[];
  /** latest answer to onSearchFiles */
  files?: { query: string; paths: string[] };
  onSend?: (text: string, images?: Attached[]) => void;
  onSearchFiles?: (query: string) => void;
  onStop?: () => void;
  onRemoveQueued?: (index: number) => void;
};

const busy: SessionState[] = ['running', 'awaiting_permission', 'awaiting_answer', 'compacting', 'retrying'];

export function Composer({ state, queued = [], suggestion, disabledReason, initialDraft = '', commands = [], files, onSend, onSearchFiles, onStop, onRemoveQueued }: Props) {
  const [text, setText] = useState(initialDraft);
  const [caret, setCaret] = useState(initialDraft.length);
  const [images, setImages] = useState<Attached[]>([]);
  const [problem, setProblem] = useState<string>();
  const [active, setActive] = useState(0);
  const [dismissed, setDismissed] = useState<string>();
  const box = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const running = busy.includes(state);
  const disabled = Boolean(disabledReason);

  const trigger = triggerAt(text, caret);
  const open = trigger && dismissed !== `${trigger.kind}${trigger.start}` ? trigger : undefined;
  const options = !open ? [] : open.kind === 'slash'
    ? matchCommands(commands, open.query).map((c) => ({ key: c.name, label: `/${c.name}`, hint: c.hint, note: c.description, insert: `/${c.name}` }))
    : (files?.paths ?? []).slice(0, 8).map((p) => ({ key: p, label: p, hint: undefined, note: undefined, insert: `@${p}` }));

  const fileQuery = open?.kind === 'file' ? open.query : undefined;
  useEffect(() => {
    if (fileQuery === undefined) return;
    const t = setTimeout(() => onSearchFiles?.(fileQuery), 120);
    return () => clearTimeout(t);
  }, [fileQuery, onSearchFiles]);
  useEffect(() => setActive(0), [open?.kind, open?.query]);

  const send = () => {
    if ((!text.trim() && !images.length) || disabled) return;
    onSend?.(text.trim(), images.length ? images : undefined);
    setText('');
    setImages([]);
    setProblem(undefined);
  };

  const pick = (i: number) => {
    const o = options[i];
    if (!open || !o) return;
    const next = complete(text, open, o.insert);
    setText(next.text);
    setCaret(next.caret);
    requestAnimationFrame(() => box.current?.setSelectionRange(next.caret, next.caret));
  };

  const attach = async (list: File[]) => {
    const pics = list.filter(isImage);
    if (list.length && !pics.length) return setProblem(strings.composer.notImage);
    const room = MAX_IMAGES - images.length;
    setProblem(pics.length > room ? strings.composer.tooMany : undefined);
    const got: Attached[] = [];
    for (const f of pics.slice(0, Math.max(room, 0))) {
      try {
        const im = await readImage(f);
        if (im) got.push(im);
        else setProblem(strings.composer.tooBig);
      } catch {
        setProblem(strings.composer.notImage);
      }
    }
    if (got.length) setImages((cur) => [...cur, ...got].slice(0, MAX_IMAGES));
  };
  const onPaste = (e: ClipboardEvent) => {
    const pics = [...e.clipboardData.files].filter(isImage);
    if (pics.length) {
      e.preventDefault();
      void attach(pics);
    }
  };
  const onDrop = (e: DragEvent) => {
    if (!e.dataTransfer.files.length) return;
    e.preventDefault();
    void attach([...e.dataTransfer.files]);
  };

  // Enter sends (queues while running), Shift+Enter is a newline, Tab takes the suggestion when the box is empty (PLAN.md §9.1)
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (open && options.length) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        setActive((a) => (a + (e.key === 'ArrowDown' ? 1 : options.length - 1)) % options.length);
        return;
      }
      if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') {
        e.preventDefault();
        return pick(active);
      }
    }
    if (open && e.key === 'Escape') {
      e.stopPropagation(); // closes the list only; it must not also stop Claude
      return setDismissed(`${open.kind}${open.start}`);
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send();
    } else if (e.key === 'Tab' && !e.shiftKey && !text && suggestion) {
      e.preventDefault();
      setText(suggestion);
    }
  };

  return (
    <div className="@container border-t border-line bg-paper px-4 pt-2 pb-3" onDrop={onDrop} onDragOver={(e) => e.preventDefault()}>
      <div className="relative mx-auto w-full max-w-[780px]">
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
        {open && (
          <ul id="composer-options" role="listbox" aria-label={open.kind === 'slash' ? strings.composer.commands : strings.composer.files} className="absolute right-0 bottom-full left-0 z-10 mb-1 max-h-64 overflow-auto rounded-card border border-line bg-card p-1 shadow-lg">
            {options.length === 0 && <li className="px-2 py-1.5 text-sm text-muted">{strings.composer.noMatch}</li>}
            {options.map((o, i) => (
              <li key={o.key} id={`composer-opt-${i}`} role="option" aria-selected={i === active} onMouseDown={(e) => { e.preventDefault(); pick(i); }} onMouseEnter={() => setActive(i)} className={`flex cursor-pointer items-baseline gap-2 rounded-control px-2 py-1.5 text-sm ${i === active ? 'bg-well' : ''}`}>
                <span className="font-mono">{o.label}</span>
                {o.hint && <span className="text-muted">{o.hint}</span>}
                {o.note && <span className="min-w-0 flex-1 truncate text-right text-muted">{o.note}</span>}
              </li>
            ))}
          </ul>
        )}
        {images.length > 0 && (
          <ul className="mb-2 flex flex-wrap gap-2">
            {images.map((im, i) => (
              <li key={i} className="enter relative">
                <img src={imageSrc(im)} alt={strings.composer.attached(i + 1)} className="size-16 rounded-control border border-line object-cover" />
                <IconButton label={strings.composer.removeImage(i + 1)} onClick={() => setImages((cur) => cur.filter((_, j) => j !== i))} className="absolute -top-2 -right-2 size-6 bg-card"><X aria-hidden className="size-3.5" /></IconButton>
              </li>
            ))}
          </ul>
        )}
        <div className={`flex flex-wrap items-end gap-2 rounded-card border bg-card p-2 ${disabled ? 'border-line' : 'border-line focus-within:border-accent'}`}>
          <label htmlFor="composer" className="sr-only">{strings.composer.label}</label>
          <textarea
            id="composer"
            ref={box}
            rows={1}
            value={text}
            disabled={disabled}
            role="combobox"
            aria-expanded={Boolean(open)}
            aria-controls={open ? 'composer-options' : undefined}
            aria-activedescendant={open && options.length ? `composer-opt-${active}` : undefined}
            aria-autocomplete="list"
            aria-describedby={disabled ? 'composer-why' : undefined}
            placeholder={strings.composer.placeholder}
            onChange={(e) => {
              setText(e.target.value);
              setCaret(e.target.selectionStart);
            }}
            onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
            onPaste={onPaste}
            onKeyDown={onKeyDown}
            className="max-h-[40dvh] min-h-9 min-w-0 flex-1 basis-full resize-none disabled:text-muted @md:basis-0 bg-transparent px-1 py-1.5 text-base [field-sizing:content] placeholder:text-muted focus:outline-none"
          />
          <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/gif,image/webp" multiple hidden aria-label={strings.composer.attach} onChange={(e) => { void attach([...(e.target.files ?? [])]); e.target.value = ''; }} />
          <div className="ml-auto flex gap-2">
            <IconButton label={strings.composer.attach} onClick={() => fileInput.current?.click()} disabled={disabled}><ImagePlus aria-hidden className="size-4" /></IconButton>
            {running && (
              <Button variant="danger" onClick={onStop} aria-keyshortcuts="Escape">
                <Square aria-hidden className="size-3.5 fill-current" /> {strings.composer.stop}
              </Button>
            )}
            <Button variant="primary" onClick={send} disabled={disabled || (!text.trim() && !images.length)} aria-label={strings.composer.send}>
              <ArrowUp aria-hidden className="size-4" /> {strings.composer.send}
            </Button>
          </div>
        </div>
        {problem && <p role="status" className="mt-1 text-sm text-muted">{problem}</p>}
        {disabled && <p id="composer-why" className="mt-1 text-sm text-muted">{disabledReason}</p>}
      </div>
    </div>
  );
}
