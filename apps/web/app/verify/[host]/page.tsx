'use client';

import { use, useEffect, useState } from 'react';
import { PublicKey } from '@solana/web3.js';
import type { ArenaView } from '@pokestonksss/sdk';
import { getClient } from '../../../lib/chain/config';
import { rules, type Mood, type Slot } from '../../../lib/rules';
import { Panel } from '../../components/ui';

/** Replays a match from its on-chain log through the shared rules and compares it with the stored state. */
export default function VerifyPage({ params }: { params: Promise<{ host: string }> }) {
  const { host } = use(params);
  const [arena, setArena] = useState<ArenaView | null | undefined>(undefined);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const pk = new PublicKey(host);
        const c = getClient();
        setArena((await c.getArena(pk, 'er')) ?? (await c.getArena(pk, 'base')));
      } catch (e) { setErr(String((e as Error).message)); setArena(null); }
    })();
  }, [host]);

  if (arena === undefined) return <main className="p-8 font-pixel t-10">Loading…</main>;
  if (!arena) return <main className="p-8"><Panel><p>{err ?? 'No arena found for this address.'}</p></Panel></main>;

  const [a, b] = arena.match.sides.map((s) => s.species);
  let state = rules.newMatch(a, b);
  const roster = rules.roster();
  const rows = arena.log.map((e, i) => {
    const rnd = new Uint8Array(32); rnd.set(e.rnd);
    const res = rules.resolveTurn(state, e.picks as [Slot, Slot], rnd, e.mood as Mood[] as [Mood, Mood]);
    state = res.state;
    return { i, picks: e.picks, mood: e.mood, rnd: e.rnd.map((x) => x.toString(16).padStart(2, '0')).join(''), hp: state.fighters.map((f) => f.hp) };
  });
  const ok = state.fighters[0].hp === arena.match.sides[0].hp && state.fighters[1].hp === arena.match.sides[1].hp && state.turn === arena.match.turn;
  return (
    <main className="mx-auto max-w-3xl p-4 sm:p-8">
      <h1 className="font-pixel t-16 text-navy mb-2">Verify match</h1>
      <Panel tone={ok ? 'plate' : 'dialog'} className="mb-4">
        <p className="font-pixel t-10">{ok ? '✓ Replay matches the on-chain state' : '✗ Replay does NOT match'}</p>
        <p className="text-sm mt-1">{roster[a]?.name} vs {roster[b]?.name} · {arena.log.length} turns · winner {arena.winner === 255 ? 'none yet' : `side ${arena.winner}`}</p>
        <p className="text-xs text-slate mt-1 break-all">arena owner {host}</p>
      </Panel>
      <ol className="space-y-2">
        {rows.map((r) => (
          <li key={r.i}><Panel className="!py-2 text-xs break-all">
            <b>Turn {r.i + 1}</b> picks {r.picks.join(' / ')} · mood {r.mood.join(' / ')} · hp {r.hp.join(' / ')}<br />
            <span className="text-slate">VRF randomness: {r.rnd}</span>
          </Panel></li>
        ))}
      </ol>
    </main>
  );
}
