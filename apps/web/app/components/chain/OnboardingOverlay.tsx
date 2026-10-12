'use client';

import { useEffect } from 'react';
import { useChain } from '../../../lib/chain/store';
import { Button, Panel, Spinner } from '../ui';

const LABELS: Record<string, string> = {
  funding: 'Getting devnet SOL',
  creating: 'Creating your Trainer + Arena',
  delegating: 'Moving them onto the rollup',
  cloning: 'Waiting for the rollup to pick them up',
  ready: 'Wristband ready',
};
const ORDER = ['funding', 'creating', 'delegating', 'cloning', 'ready'] as const;

/** First-visit screen: a resumable 3–4 s setup with real transaction links. Renders nothing once ready. */
export default function OnboardingOverlay({ onReady }: { onReady?: () => void }) {
  const { status, steps, error, boot, address } = useChain();

  useEffect(() => { if (status === 'idle') void boot(); }, [status, boot]);
  useEffect(() => { if (status === 'ready') onReady?.(); }, [status, onReady]);

  if (status === 'ready') return null;
  const done = new Set(steps.map((s) => s.step));
  const current = status === 'error' ? null : ORDER.find((s) => !done.has(s));

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-navy-deep/80 p-4" role="dialog" aria-modal="true" aria-label="Setting up your wristband">
      <Panel tone="dialog" className="w-full max-w-md on-navy">
        <h2 className="font-pixel t-14 text-yellow mb-3">Getting your wristband</h2>
        <p className="text-sm text-cream mb-4">
          One-time setup (about 4 seconds). Your battle slot is moved onto a MagicBlock Ephemeral Rollup so every move after this is instant. Devnet only: no real money.
        </p>
        <ul className="space-y-2" aria-live="polite">
          {ORDER.filter((s) => s !== 'ready').map((s) => {
            const entry = steps.find((x) => x.step === s);
            const isDone = done.has(s) || done.has('ready');
            const isCur = current === s;
            return (
              <li key={s} className="flex items-center gap-2 font-pixel t-10 text-cream">
                <span className="w-4 text-center">{isDone ? '✓' : isCur ? <Spinner /> : '·'}</span>
                <span className={isDone ? 'text-green' : isCur ? 'text-yellow' : 'text-slate-soft'}>{LABELS[s]}</span>
                {entry?.link && <a className="ml-auto text-sky underline" href={entry.link} target="_blank" rel="noreferrer">tx ↗</a>}
              </li>
            );
          })}
        </ul>
        {error && (
          <div className="mt-4" role="alert">
            <p className="text-sm text-yellow mb-2">{error}</p>
            <Button onClick={() => void boot()}>Try again</Button>
          </div>
        )}
        {address && <p className="mt-4 font-mono text-[11px] text-slate-soft break-all">guest {address}</p>}
      </Panel>
    </div>
  );
}
