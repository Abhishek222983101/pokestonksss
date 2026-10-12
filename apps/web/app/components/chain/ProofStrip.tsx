'use client';

import { useProof } from '../../../lib/chain/proof';
import { getClient } from '../../../lib/chain/config';
import { useEffect, useState } from 'react';

const ext = (href: string, children: React.ReactNode, title?: string) => (
  <a href={href} target="_blank" rel="noreferrer" title={title} className="underline decoration-dotted underline-offset-2">{children}</a>
);

/** Weighed · Sealed · Rolled · Saved — every chip links to an explorer transaction. */
export default function ProofStrip({ sealedMode = 'commit-reveal' }: { sealedMode?: string }) {
  const { weighed, sealed, rolled, saved, start } = useProof();
  const [lat, setLat] = useState({ p50: 0, p95: 0, n: 0 });
  useEffect(() => {
    const l = getClient().latency;
    const upd = () => setLat({ p50: l.p50, p95: l.p95, n: l.count });
    upd();
    const off = l.subscribe(upd);
    return () => { off(); };
  }, []);
  const last = rolled[rolled.length - 1];
  const chip = (on: boolean) => `panel panel-flat !m-0 !px-2 !py-1 font-pixel t-8 ${on ? 'text-ink' : 'text-slate-soft opacity-70'}`;
  const moodTxt = weighed ? weighed.mood.map((m) => (m > 0 ? '▲' : m < 0 ? '▼' : '■')).join(' ') : '–';
  return (
    <div className="flex flex-wrap items-center gap-2" aria-label="Proof strip">
      <span className="font-pixel t-8 text-green" title="This battle runs on a MagicBlock Ephemeral Rollup">● LIVE · EPHEMERAL ROLLUP · devnet</span>
      <span className={chip(!!weighed)} title="Live oracle prices vs the bell snapshot">Weighed {moodTxt}</span>
      <span className={chip(!!start || sealed.length > 0)} title={`Picks are sealed: ${sealedMode}`}>Sealed {sealed.length ? ext(sealed[sealed.length - 1].link, '↗') : start ? ext(start.link, '↗') : ''}</span>
      <span className={chip(rolled.length > 0)} title={last?.rnd ? `VRF randomness: ${last.rnd}` : 'MagicBlock VRF roll'}>Rolled ×{rolled.length} {last && ext(last.link, '↗')}</span>
      <span className={chip(!!saved)} title="Committed to Solana base layer">Saved {saved ? ext(saved.link, '↗') : '…'}</span>
      <span className="font-pixel t-8 text-slate" title="Measured transaction confirmation time on the rollup">{lat.n ? `${Math.round(lat.p50)} ms p50 · ${Math.round(lat.p95)} ms p95` : 'measuring…'}</span>
    </div>
  );
}
