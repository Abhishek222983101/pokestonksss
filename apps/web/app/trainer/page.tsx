'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { accountLink, handleOf, tierName, tierProgress, trainerPda } from '@pokestonksss/sdk';
import { getClient } from '../../lib/chain/config';
import { ownerKey, activeSigner } from '../../lib/chain/guest';
import { useChain } from '../../lib/chain/store';
import { BROKERMON, getBroker } from '../../lib/brokermon';
import { useSessionStore } from '../stores/sessionStore';
import { Portrait } from '../components/Portrait';
import { AvatarFace } from '../components/AvatarFace';
import RewardsPanel from '../components/chain/RewardsPanel';
import { Button, Panel } from '../components/ui';

/** Trainer Card + BrokerDex: everything here is read from your on-chain Trainer account. */
export default function TrainerPage() {
  const boot = useChain((s) => s.boot);
  const status = useChain((s) => s.status);
  const trainer = useChain((s) => s.trainer);
  const refresh = useChain((s) => s.refreshTrainer);
  const speciesId = useSessionStore((s) => s.speciesId);
  const [saving, setSaving] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => { void boot().then(() => refresh()); }, [boot, refresh]);

  if (status !== 'ready' || !trainer) {
    return <main className="mx-auto max-w-xl p-8"><Panel><p className="font-pixel t-10">{status === 'error' ? 'Could not reach the rollup.' : 'Loading your Trainer…'}</p><Link className="underline" href="/">Back to the game</Link></Panel></main>;
  }
  const tier = tierName(trainer.rating);
  const prog = tierProgress(trainer.rating);
  const me = ownerKey();
  const cfg = getClient().cfg;
  const save = async () => {
    setSaving(true); setMsg(null);
    try { const r = await getClient().commitTrainer(activeSigner()); setLink(r.link); await refresh(); setMsg('Saved to Solana ✓'); }
    catch (e) { setMsg(String((e as Error).message).slice(0, 120)); }
    setSaving(false);
  };
  return (
    <main className="mx-auto max-w-2xl p-4 sm:p-8">
      <nav className="mb-3 flex gap-2"><Link className="btn btn-sm" href="/">← Game</Link><Link className="btn btn-sm btn-secondary" href="/leaderboard">Leaderboard</Link></nav>
      <Panel tone="dialog" className="on-navy mb-4 text-cream">
        <div className="flex items-center gap-3">
          <AvatarFace avatar={trainer.avatar} size={48} />
          <Portrait speciesId={getBroker(speciesId ?? 'sol').id} size={64} />
          <div>
            <h1 className="font-pixel t-14 text-yellow">{handleOf(trainer.owner, tier)}</h1>
            <p className="font-pixel t-10">{tier} · {trainer.rating} rating</p>
          </div>
        </div>
        <div className="mt-3" aria-label="Progress to next tier">
          <div className="h-3 bg-navy-deep"><div className="h-3 bg-yellow" style={{ width: `${Math.round(prog.pct * 100)}%` }} /></div>
          <p className="mt-1 text-[12px]">{prog.next ? `${Math.round(prog.pct * 100)}% of the way to ${prog.next}` : 'Top tier reached'}</p>
        </div>
        <dl className="mt-3 grid grid-cols-4 gap-2 text-center font-pixel t-8">
          {[['WINS', trainer.wins], ['LOSSES', trainer.losses], ['STREAK', trainer.streak], ['BATTLES', trainer.battles]].map(([k, v]) => (
            <div key={k as string} className="panel panel-flat !m-0 !p-2 text-ink"><dt>{k}</dt><dd className="t-14 mt-1">{v}</dd></div>
          ))}
        </dl>
      </Panel>

      <div className="mb-4"><RewardsPanel /></div>

      <Panel className="mb-4">
        <h2 className="font-pixel t-10 mb-2">BrokerDex · {BROKERMON.filter((b) => trainer.dex & (1 << b.num)).length}/8 defeated</h2>
        <div className="grid grid-cols-4 gap-2">
          {BROKERMON.map((b) => {
            const seen = (trainer.dex & (1 << b.num)) !== 0;
            return (
              <div key={b.id} className="panel panel-flat !m-0 !p-2 text-center font-pixel t-8" title={seen ? `${b.name} defeated` : 'Defeat this BrokerMon to unlock'}>
                <div style={seen ? undefined : { filter: 'brightness(0) opacity(0.35)' }}><Portrait speciesId={b.id} size={48} /></div>
                {seen ? b.name : '???'}
              </div>
            );
          })}
        </div>
      </Panel>

      <Panel className="mb-4">
        <h2 className="font-pixel t-10 mb-1">Saved on Solana</h2>
        <p className="text-sm mb-2">{trainer.unsaved > 0 ? `${trainer.unsaved} battle(s) are on the rollup and not yet committed to Solana.` : 'Everything is committed to Solana.'} Commits so far: {trainer.commits} (the rollup allows 10 per account before re-delegating).</p>
        <Button onClick={save} disabled={saving || trainer.unsaved === 0 || trainer.commits >= 10}>{saving ? 'Saving…' : 'Save to Solana now'}</Button>
        {msg && <p className="mt-2 text-sm" role="status">{msg} {link && <a className="underline" target="_blank" rel="noreferrer" href={link}>transaction ↗</a>}</p>}
        <p className="mt-3 text-[12px] break-all">Trainer account: <a className="underline" target="_blank" rel="noreferrer" href={accountLink(trainerPda(me).toBase58(), 'er', cfg)}>{trainerPda(me).toBase58()} ↗</a></p>
      </Panel>
    </main>
  );
}
