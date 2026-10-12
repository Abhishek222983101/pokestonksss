'use client';

import { use, useEffect, useMemo, useState } from 'react';
import { PublicKey } from '@solana/web3.js';
import { SEALED, accountLink, deriveRoll, type SealedDuelView } from '@pokestonksss/sdk';
import { getSealed } from '../../../../lib/chain/sealed';
import { getClient } from '../../../../lib/chain/config';
import { rules, type Mood, type Slot } from '../../../../lib/rules';
import { Panel } from '../../../components/ui';

const hex = (a: ArrayLike<number>) => Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');

/** Verify a sealed duel: recompute every roll from the public seed and sealed nonces, then replay the whole match. */
export default function VerifySealedPage({ params }: { params: Promise<{ host: string }> }) {
  const { host } = use(params);
  const [d, setD] = useState<SealedDuelView | null | undefined>(undefined);
  const [where, setWhere] = useState<'solana' | 'tee' | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const pk = new PublicKey(host);
        const s = getSealed();
        const onBase = await s.readDuel(pk, 'base');
        if (onBase && onBase.status === SEALED.FINISHED) { setD(onBase); setWhere('solana'); return; }
        const live = await s.readDuel(pk, s.publicTee());
        setD(live ?? onBase); setWhere(live ? 'tee' : 'solana');
      } catch (e) { setErr(String((e as Error).message)); setD(null); }
    })();
  }, [host]);

  const v = useMemo(() => {
    if (!d) return null;
    const seed = Uint8Array.from(Buffer.from(d.seed, 'hex'));
    const rows = d.log.map((t, i) => {
      const r = deriveRoll(seed, i, t.picks, t.nonces);
      return { i, picks: t.picks, nonces: t.nonces.map(String), rnd: hex(t.rnd), rollOk: hex(r).slice(0, 20) === hex(t.rnd) };
    });
    let state = rules.newMatch(d.species[0], d.species[1]);
    for (const t of d.log) { const rnd = new Uint8Array(32); rnd.set(t.rnd); state = rules.resolveTurn(state, t.picks as [Slot, Slot], rnd, [0, 0] as [Mood, Mood]).state; }
    const replayOk = state.turn === d.match.turn && state.fighters[0].hp === d.match.sides[0].hp && state.fighters[1].hp === d.match.sides[1].hp;
    return { rows, replayOk, allRolls: rows.every((r) => r.rollOk) };
  }, [d]);

  if (d === undefined) return <main className="p-8 font-pixel t-10">Loading…</main>;
  if (!d || !v) return <main className="p-8"><Panel><p>{err ?? 'No sealed duel found for this match key.'}</p></Panel></main>;
  const roster = rules.roster();
  const cfg = getClient().cfg;
  const duelPda = getSealed().duel(new PublicKey(host)).toBase58();
  const ok = v.allRolls && v.replayOk;
  return (
    <main className="mx-auto max-w-3xl p-4 sm:p-8">
      <h1 className="font-pixel t-16 text-navy mb-2">Verify private duel</h1>
      <Panel tone={ok ? 'plate' : 'dialog'} className="mb-4">
        <p className="font-pixel t-10">{ok ? '✓ Every roll recomputes and the replay matches' : '✗ Verification failed'}</p>
        <p className="text-sm mt-1">{roster[d.species[0]]?.name} vs {roster[d.species[1]]?.name} · {d.log.length} turns · {d.status === SEALED.FINISHED ? `winner seat ${d.winner === 255 ? 'none' : d.winner}` : 'still running'} · read from {where === 'solana' ? 'Solana (committed)' : 'the Private ER'}</p>
        <p className="text-xs text-slate mt-1 break-all">duel account <a className="underline" target="_blank" rel="noreferrer" href={accountLink(duelPda, 'base', cfg)}>{duelPda}</a></p>
        <p className="text-xs text-slate mt-1 break-all">VRF seed (MagicBlock, base layer): 0x{d.seed}</p>
        <p className="text-xs text-slate mt-1">roll = sha256(seed ‖ turn ‖ picks ‖ nonceA ‖ nonceB). The nonces were sealed inside the TEE until each turn resolved, so neither player could predict or steer it.</p>
      </Panel>
      <ol className="space-y-2">
        {v.rows.map((r) => (
          <li key={r.i}><Panel className="!py-2 text-xs break-all">
            <b>Turn {r.i + 1}</b> picks {r.picks.join(' / ')} · nonces {r.nonces.join(' / ')} · {r.rollOk ? '✓ roll matches' : '✗ roll mismatch'}<br />
            <span className="text-slate">roll bytes: {r.rnd}</span>
          </Panel></li>
        ))}
      </ol>
    </main>
  );
}
