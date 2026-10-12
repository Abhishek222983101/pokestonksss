'use client';

import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';
import { PublicKey } from '@solana/web3.js';
import { ChainDuelSource, type DuelRole } from '../../../lib/chain/ChainDuelSource';
import { brokerByNum } from '../../../lib/brokermon';
import ProofDock from './ProofDock';

const PhaserMount = dynamic(() => import('../../game/PhaserMount'), { ssr: false });

/** Full-screen sealed duel: attaches to the shared arena on the rollup and mounts the battle scene. */
export default function DuelStage({ role, host, hostSpecies, guestSpecies, opponent, onExit }: {
  role: DuelRole; host: PublicKey; hostSpecies: number; guestSpecies: number; opponent: PublicKey; onExit: () => void;
}) {
  const [source, setSource] = useState<ChainDuelSource | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Each mount owns its own source (StrictMode mounts, unmounts, mounts again in dev).
    const s = new ChainDuelSource(role, host, hostSpecies, guestSpecies, opponent);
    let alive = true;
    s.attach().then(() => { if (alive) setSource(s); }, (e) => { if (alive) setError(String((e as Error).message)); });
    return () => { alive = false; void s.leave(); };
  }, [role, host, hostSpecies, guestSpecies, opponent]);

  if (error) return <div className="fixed inset-0 z-[60] grid place-items-center bg-navy-deep p-6 text-cream"><p className="font-pixel t-10">{error}</p></div>;
  if (!source) return <div className="fixed inset-0 z-[60] grid place-items-center bg-navy-deep text-cream"><p className="font-pixel t-10">Joining the duel…</p></div>;
  const mine = brokerByNum(role === 'host' ? hostSpecies : guestSpecies);
  return (
    <>
      <PhaserMount routeId={mine.routeId} speciesId={mine.id} duelSource={source} onExit={onExit} />
      <ProofDock sealedMode="sealed commit-reveal" />
    </>
  );
}
