'use client';

import { useEffect, useState } from 'react';
import { initRules } from '../../lib/rules';

/** Holds the app until the Rust rules engine (WASM) is loaded, so the UI and the chain always share one rulebook. */
export default function RulesGate({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  useEffect(() => { initRules().then(() => setState('ready'), () => setState('error')); }, []);
  if (state === 'ready') return <>{children}</>;
  return (
    <div className="grid min-h-dvh place-items-center bg-navy-deep text-cream">
      <p className="font-pixel t-10" role="status">{state === 'error' ? 'Could not load the game rules. Reload the page.' : 'Loading rules…'}</p>
    </div>
  );
}
