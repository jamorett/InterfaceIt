import { FileText } from 'lucide-react';
import { strings } from '../strings.ts';

export function EmptySession({ hasInstructions = true, onPick }: { hasInstructions?: boolean; onPick?: (text: string) => void }) {
  return (
    <div className="grid min-h-0 flex-1 place-items-center overflow-auto p-4">
      <div className="enter-slow w-full max-w-[560px]">
        <h2 className="text-lg font-semibold">{strings.empty.title}</h2>
        {hasInstructions && (
          <p className="mt-1 flex items-center gap-1.5 text-sm text-muted">
            <FileText aria-hidden className="size-3.5" /> {strings.empty.memory}
          </p>
        )}
        <ul className="mt-4 grid gap-2">
          {strings.empty.starters.map((s) => (
            <li key={s}>
              <button type="button" onClick={() => onPick?.(s)} className="press hoverable w-full rounded-card border border-line bg-card px-3 py-2 text-left text-base pointer-coarse:min-h-11">{s}</button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
