'use client';

import dynamic from 'next/dynamic';
import { useEffect, useRef, useState } from 'react';
import { PublicKey } from '@solana/web3.js';
import { ChainDuelSource, type DuelRole } from '../../../lib/chain/ChainDuelSource';
import { brokerByNum } from '../../../lib/brokermon';
import ProofStrip from './ProofStrip';

const PhaserMount = dynamic(() => import('../../game/PhaserMount'), { ssr: false });

/** Full-screen sealed duel: attaches to the shared arena on the rollup and mounts the battle scene. */
export default function DuelStage({ role, host, hostSpecies, guestSpecies, opponent, onExit }: {
  role: DuelRole; host: PublicKey; hostSpecies: number; guestSpecies: number; opponent: PublicKey; onExit: () => void;
}) {
  const [source, setSource] = useState<ChainDuelSource | null>(null);
  const [error, setError] = useState<string | null>(null);
  const made = useRef(false);

  useEffect(() => {
    if (made.current) return;
    made.current = true;
    const s = new ChainDuelSource(role, host, hostSpecies, guestSpecies, opponent);
    s.attach().then(() => setSource(s), (e) => setError(String((e as Error).message)));
    return () => { void s.leave(); };
  }, [role, host, hostSpecies, guestSpecies, opponent]);

  if (error) return <div className="fixed inset-0 z-[60] grid place-items-center bg-navy-deep p-6 text-cream"><p className="font-pixel t-10">{error}</p></div>;
  if (!source) return <div className="fixed inset-0 z-[60] grid place-items-center bg-navy-deep text-cream"><p className="font-pixel t-10">Joining the duel…</p></div>;
  const mine = brokerByNum(role === 'host' ? hostSpecies : guestSpecies);
  return (
    <>
      <PhaserMount routeId={mine.routeId} speciesId={mine.id} duelSource={source} onExit={onExit} />
      <div className="pointer-events-none fixed left-2 top-1 z-[70] max-w-[calc(100vw-1rem)]">
        <div className="pointer-events-auto panel panel-dialog on-navy !m-0 !py-1 !px-2 text-cream"><ProofStrip compact sealedMode="sealed commit-reveal" /></div>
      </div>
    </>
  );
}
