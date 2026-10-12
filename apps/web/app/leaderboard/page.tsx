'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { accountLink, handleOf, tierName, trainerPda, type TrainerView } from '@pokestonksss/sdk';
import { PublicKey } from '@solana/web3.js';
import { getClient } from '../../lib/chain/config';
import { ownerKey } from '../../lib/chain/guest';
import { Panel } from '../components/ui';

/** Live ranking of every Trainer on the rollup (read straight from chain; no indexer or database). */
export default function LeaderboardPage() {
  const [rows, setRows] = useState<TrainerView[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const me = useSyncExternalStore(() => () => {}, () => ownerKey().toBase58(), () => '');

  useEffect(() => {
    getClient().listTrainers().then((r) => setRows(r.filter((t) => t.battles > 0)), (e) => setErr(String((e as Error).message)));
  }, []);

  return (
    <main className="mx-auto max-w-2xl p-4 sm:p-8">
      <nav className="mb-3 flex gap-2"><Link className="btn btn-sm" href="/">← Game</Link><Link className="btn btn-sm btn-secondary" href="/trainer">Your card</Link></nav>
      <h1 className="font-pixel t-14 text-navy mb-1">Leaderboard</h1>
      <p className="text-sm mb-3">Every ranked Trainer on the MagicBlock rollup, read directly from the program&apos;s accounts. Rating is Elo; tiers run Shrimp → Crab → Dolphin → Shark → Whale.</p>
      {err && <Panel><p role="alert">{err}</p></Panel>}
      {!rows && !err && <p className="font-pixel t-10">Loading…</p>}
      {rows && rows.length === 0 && <Panel><p>No ranked battles yet. Be the first!</p></Panel>}
      <ol className="space-y-2">
        {rows?.slice(0, 25).map((t, i) => {
          const mine = t.owner === me;
          return (
            <li key={t.owner}>
              <Panel tone={mine ? 'dialog' : 'plate'} className={`!py-2 flex items-center gap-3 ${mine ? 'on-navy text-cream' : ''}`}>
                <span className="font-pixel t-12 w-8 text-right">{i + 1}</span>
                <span className="min-w-0 flex-1">
                  <span className="font-pixel t-10">{handleOf(t.owner, tierName(t.rating))}{mine ? ' (you)' : ''}</span>
                  <span className="block text-[12px] opacity-80">{t.wins}W {t.losses}L · streak {t.streak} · {t.battles} battles</span>
                </span>
                <span className="font-pixel t-12 tabular-nums">{t.rating}</span>
                <a className="text-[12px] underline" target="_blank" rel="noreferrer" href={accountLink(trainerPda(new PublicKey(t.owner)).toBase58(), 'er', getClient().cfg)}>acct ↗</a>
              </Panel>
            </li>
          );
        })}
      </ol>
    </main>
  );
}
