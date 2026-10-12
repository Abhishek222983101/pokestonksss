'use client';

import { useCallback, useState } from 'react';
import { PROGRAM_ID, accountLink, arenaPda, tierName, trainerPda } from '@pokestonksss/sdk';
import { getClient } from '../../lib/chain/config';
import { guestKeypair, guestSigner } from '../../lib/chain/guest';
import { useChain } from '../../lib/chain/store';
import { Button, Panel } from '../components/ui';

interface Row { name: string; ok: boolean | null; detail: string; link?: string }

/** One-click proof for judges: plays a real practice battle on the rollup and lists every verifiable artifact. */
export default function JudgePage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [running, setRunning] = useState(false);
  const boot = useChain((s) => s.boot);

  const push = useCallback((r: Row) => setRows((x) => [...x, r]), []);

  const run = useCallback(async () => {
    setRows([]); setRunning(true);
    const client = getClient(); const signer = guestSigner(); const me = guestKeypair().publicKey;
    try {
      const t0 = performance.now();
      await boot();
      if (useChain.getState().status !== 'ready') throw new Error(useChain.getState().error ?? 'onboarding failed');
      push({ name: 'Guest onboarded (Trainer + Arena delegated to the rollup)', ok: true, detail: `${Math.round(performance.now() - t0)} ms`, link: accountLink(trainerPda(me).toBase58(), 'er', client.cfg) });
      const s = await client.startPractice(signer, 0, 1, 1);
      push({ name: 'start_practice ran on the Ephemeral Rollup', ok: true, detail: `${s.ms} ms`, link: s.link });
      let a = await client.getArena(me);
      let n = 0;
      while (a && a.phase !== 5 && n < 30) {
        const turn = a.match.turn;
        const r = await client.lockPick(signer, Math.floor(Math.random() * 4));
        const t = performance.now();
        do { await new Promise((x) => setTimeout(x, 60)); a = await client.getArena(me); } while (a && a.match.turn === turn && a.phase !== 5 && performance.now() - t < 20000);
        n++;
        push({ name: `Turn ${n}: pick locked, MagicBlock VRF rolled, rules resolved on-chain`, ok: !!a && (a.match.turn > turn || a.phase === 5), detail: `lock ${r.ms} ms · resolved +${Math.round(performance.now() - t)} ms · hp ${a?.match.sides[0].hp}/${a?.match.sides[1].hp}`, link: r.link });
      }
      push({ name: 'Battle finished', ok: a?.phase === 5, detail: a ? `winner side ${a.winner}, ${a.log.length} turns logged on-chain` : '' });
      if (a) push({ name: 'Oracle weigh-in snapshot taken', ok: a.snap[0] > 0n || a.snap[1] > 0n, detail: `price snapshots ${a.snap.map(String).join(' / ')} (0 = oracle idle, mood stays flat)` });
      const c = await client.commitTrainer(signer);
      push({ name: 'Saved to Solana (commit from the rollup)', ok: true, detail: `${c.ms} ms`, link: c.link });
      const tr = await client.getTrainer(me);
      push({ name: 'Rewards landed on your Trainer, no claim step', ok: !!tr && tr.battles > 0, detail: tr ? `${tierName(tr.rating)} · rating ${tr.rating} · W${tr.wins}/L${tr.losses}` : '' });
      push({ name: 'Verify any match: replay it from chain data', ok: true, detail: 'open the verify page for this arena', link: `/verify/${me.toBase58()}` });
    } catch (e) {
      push({ name: 'Self-test stopped', ok: false, detail: String((e as Error).message).slice(0, 200) });
    } finally { setRunning(false); }
  }, [boot, push]);

  const cfg = getClient().cfg;
  return (
    <main className="mx-auto max-w-3xl p-4 sm:p-8">
      <h1 className="font-pixel t-16 text-navy mb-2">Judge self-test</h1>
      <p className="mb-4 text-sm">Plays a real battle on MagicBlock devnet from this browser and lists every proof. No wallet needed. About 30 seconds.</p>
      <Panel className="mb-4">
        <dl className="grid grid-cols-[8rem_1fr] gap-y-1 text-sm break-all">
          <dt className="font-pixel t-8">Program</dt><dd><a className="underline" target="_blank" rel="noreferrer" href={accountLink(PROGRAM_ID.toBase58(), 'base', cfg)}>{PROGRAM_ID.toBase58()}</a></dd>
          <dt className="font-pixel t-8">Rollup</dt><dd>{cfg.erHttp} (validator {cfg.validator.toBase58().slice(0, 8)}…)</dd>
          <dt className="font-pixel t-8">Your arena</dt><dd>{typeof window === 'undefined' ? '' : arenaPda(guestKeypair().publicKey).toBase58()}</dd>
        </dl>
      </Panel>
      <Button onClick={run} disabled={running}>{running ? 'Running…' : 'Run self-test'}</Button>
      <ol className="mt-4 space-y-2" aria-live="polite">
        {rows.map((r, i) => (
          <li key={i}><Panel tone="plate" className="!py-2">
            <div className="flex items-start gap-2">
              <span className={`font-pixel t-12 ${r.ok === false ? 'text-red-deep' : 'text-navy'}`}>{r.ok === false ? '✗' : '✓'}</span>
              <div className="min-w-0">
                <div className="text-sm font-medium">{r.name}</div>
                <div className="text-xs text-slate break-all">{r.detail} {r.link && <a className="underline" target={r.link.startsWith('/') ? undefined : '_blank'} rel="noreferrer" href={r.link}>link ↗</a>}</div>
              </div>
            </div>
          </Panel></li>
        ))}
      </ol>
    </main>
  );
}
