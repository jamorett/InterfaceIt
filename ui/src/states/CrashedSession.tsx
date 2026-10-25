import { TriangleAlert } from 'lucide-react';
import { Button } from '../components/Button.tsx';
import { strings } from '../strings.ts';

export function CrashedSession({ message, onResume }: { message: string; onResume?: () => void }) {
  return (
    <div className="grid min-h-0 flex-1 place-items-center overflow-auto p-4">
      <section role="alert" className="enter-slow w-full max-w-[480px] rounded-card border border-danger bg-card p-5">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <TriangleAlert aria-hidden className="size-5 text-danger" /> {strings.crashed.title}
        </h2>
        <p className="mt-2 text-base text-muted">{strings.crashed.detail}</p>
        <p className="mt-2 rounded-control bg-well p-2 font-mono text-sm [overflow-wrap:anywhere]">{message}</p>
        <Button variant="primary" className="mt-4" onClick={onResume}>{strings.crashed.resume}</Button>
      </section>
    </div>
  );
}
