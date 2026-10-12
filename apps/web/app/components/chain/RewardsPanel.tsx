'use client';

import { useEffect } from 'react';
import { BADGES, levelProgress, badgesEarned, tierName, type TrainerView } from '@pokestonksss/sdk';
import { useChain } from '../../../lib/chain/store';
import { useRewards } from '../../../lib/chain/rewards';
import { getClient } from '../../../lib/chain/config';
import { ownerKey } from '../../../lib/chain/guest';
import { evolvedName, stageStars } from '../../../lib/evolution';
import { rules } from '../../../lib/rules';
import { Panel } from '../ui';
import { Portrait } from '../Portrait';
import { BROKERMON } from '../../../lib/brokermon';
import { badgeMintPda } from '@pokestonksss/sdk';

const RARITY: Record<string, string> = { common: 'border-sky/60', rare: 'border-yellow', epic: 'border-pink' };

/** Levels, evolutions and badge tokens, each with a link to the on-chain account behind it. */
export default function RewardsPanel({ onClose }: { onClose?: () => void }) {
  const trainer = useChain((s) => s.trainer);
  const identity = useChain((s) => s.identity);
  const { claimed, minted, syncing, error, load, sync } = useRewards();
  const cfg = getClient().cfg;

  useEffect(() => { void load(); }, [load]);

  const owner = typeof window === 'undefined' ? null : ownerKey();
  const earned = trainer ? badgesEarned(trainer) : BADGES.map(() => false);
  const roster = rules.roster();

  return (
    <Panel tone="dialog" className="pointer-events-auto w-[min(100%_-_1rem,44rem)] max-h-[88dvh] overflow-y-auto on-navy" role="dialog" aria-label="Rewards">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-pixel t-12 text-yellow">Rewards</h2>
        {onClose && <button type="button" className="btn btn-sm btn-quiet" onClick={onClose}>Close</button>}
      </div>
      <p className="text-sm text-cream/85 mt-1">
        Win battles to level up your BrokerMons (they evolve at Lv 4 and Lv 7) and to earn badge tokens. Badges are real SPL tokens minted to{' '}
        {identity === 'wallet' ? 'your wallet' : 'your guest key (connect a wallet to keep them in Phantom)'}.
        {owner && <> <a className="underline text-sky" target="_blank" rel="noreferrer" href={`https://explorer.solana.com/address/${owner.toBase58()}/tokens?cluster=devnet`}>See tokens ↗</a></>}
      </p>

      <h3 className="font-pixel t-10 text-cream mt-3 mb-1">Badges ({claimed.filter((i) => i < 8).length}/8)</h3>
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {BADGES.filter((b) => b.id < 8).map((b) => {
          const got = claimed.includes(b.id);
          const ready = !got && earned[b.id];
          const m = minted.find((x) => x.id === b.id);
          return (
            <li key={b.id} className={`rounded-sm border-2 p-2 ${RARITY[b.rarity]} ${got ? 'bg-yellow/15' : ready ? 'bg-sky/10' : 'bg-navy-deep/60 opacity-70'}`}>
              <p className="font-pixel t-8 text-cream">{got ? '✓ ' : ready ? '… ' : '🔒 '}{b.name}</p>
              <p className="text-[12px] text-cream/80 leading-snug">{b.how}</p>
              <p className="mt-1 text-[11px]">
                {got ? (
                  <>
                    <a className="underline text-sky" target="_blank" rel="noreferrer" href={`https://explorer.solana.com/address/${badgeMintPda(b.id, cfg.programId).toBase58()}?cluster=devnet`}>token mint ↗</a>
                    {m?.link && <> · <a className="underline text-sky" target="_blank" rel="noreferrer" href={m.link}>mint tx ↗</a></>}
                  </>
                ) : ready ? <span className="text-yellow">{syncing ? 'minting to your wallet…' : 'earned, minting soon'}</span> : <span className="text-cream/60">{b.rarity}</span>}
              </p>
            </li>
          );
        })}
      </ul>
      {(claimed.length < BADGES.length && earned.some((e, i) => e && !claimed.includes(i))) && (
        <p className="mt-2 text-sm"><button type="button" className="btn btn-sm" disabled={syncing} onClick={() => void sync()}>{syncing ? 'Minting…' : 'Mint earned badges now'}</button></p>
      )}
      {error && <p role="alert" className="mt-1 text-sm text-yellow">{error}</p>}

      <h3 className="font-pixel t-10 text-cream mt-3 mb-1">Captured assets ({claimed.filter((i) => i >= 8).length}/8)</h3>
      <p className="text-[12px] text-cream/75 mb-1">Beat a BrokerMon and its trophy token is minted to {identity === 'wallet' ? 'your wallet' : 'your guest key'}. Devnet tokens that stand for the asset you took down, not real securities.</p>
      <ul className="grid grid-cols-4 gap-2">
        {BADGES.filter((b) => b.id >= 8).map((b) => {
          const got = claimed.includes(b.id);
          const ready = !got && earned[b.id];
          const broker = BROKERMON[b.species ?? 0];
          const m = minted.find((x) => x.id === b.id);
          return (
            <li key={b.id} className={`rounded-sm border-2 p-1 text-center ${got ? 'border-yellow bg-yellow/15' : ready ? 'border-sky/60 bg-sky/10' : 'border-slate/50 bg-navy-deep/60'}`}>
              <div style={got || ready ? undefined : { filter: 'brightness(0) opacity(0.35)' }} className="grid place-items-center"><Portrait speciesId={broker.id} size={40} /></div>
              <p className="font-pixel t-8 text-cream mt-1">${broker.ticker}</p>
              <p className="text-[11px]">
                {got ? (<><a className="underline text-sky" target="_blank" rel="noreferrer" href={`https://explorer.solana.com/address/${badgeMintPda(b.id, cfg.programId).toBase58()}?cluster=devnet`}>token ↗</a>{m?.link && <> · <a className="underline text-sky" target="_blank" rel="noreferrer" href={m.link}>tx ↗</a></>}</>)
                  : ready ? <span className="text-yellow">{syncing ? 'minting…' : 'earned'}</span> : <span className="text-cream/60">beat it</span>}
              </p>
            </li>
          );
        })}
      </ul>

      <h3 className="font-pixel t-10 text-cream mt-3 mb-1">BrokerMon levels</h3>
      <ul className="grid grid-cols-1 gap-1 sm:grid-cols-2">
        {roster.map((c) => {
          const xp = trainer?.xp[c.id] ?? 0;
          const lp = levelProgress(xp);
          return (
            <li key={c.id} className="rounded-sm bg-navy-deep/60 p-2">
              <p className="flex items-baseline justify-between"><span className="font-pixel t-8 text-cream">{evolvedName(c.id, lp.level)} {stageStars(lp.level)}</span><span className="font-pixel t-8 text-yellow">Lv {lp.level + 1}</span></p>
              <div className="mt-1 h-2 w-full bg-[#3a3f66]" role="presentation"><div className="h-2 bg-yellow" style={{ width: `${Math.round(lp.pct * 100)}%` }} /></div>
              <p className="text-[11px] text-cream/70">{lp.toNext === null ? 'Max level' : `${xp} xp, ${lp.toNext} to next level`} · +{lp.level * 4}% stats</p>
            </li>
          );
        })}
      </ul>
      <p className="mt-2 text-[12px] text-cream/70">Rating {trainer?.rating ?? '…'} · {trainer ? tierName(trainer.rating) : ''} · Progress is saved to Solana after each battle; badges mint from that saved copy.</p>
    </Panel>
  );
}
export type { TrainerView };
