'use client';

import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';
import { Keypair, PublicKey } from '@solana/web3.js';
import type { TeeSession } from '@pokestonksss/sdk';
import { SealedDuelSource } from '../../../lib/chain/SealedDuelSource';
import type { DuelRole } from '../../../lib/chain/ChainDuelSource';
import { brokerByNum } from '../../../lib/brokermon';
import SealedProofDock from './SealedProofDock';

const PhaserMount = dynamic(() => import('../../game/PhaserMount'), { ssr: false });

/** Full-screen private duel: attaches to the TEE duel and mounts the battle scene. */
export default function SealedDuelStage({ role, host, kp, tee, players, species, onExit }: {
  role: DuelRole; host: PublicKey; kp: Keypair; tee: TeeSession; players: [PublicKey, PublicKey]; species: [number, number]; onExit: () => void;
}) {
  const [source, setSource] = useState<SealedDuelSource | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const s = new SealedDuelSource(role, host, kp, tee, players, species);
    let alive = true;
    s.attach().then(() => { if (alive) setSource(s); }, (e) => { if (alive) setError(String((e as Error).message)); });
    return () => { alive = false; void s.leave(); };
  }, [role, host, kp, tee, players, species]);

  if (error) return <div className="fixed inset-0 z-[60] grid place-items-center bg-navy-deep p-6 text-cream"><p className="font-pixel t-10">{error}</p></div>;
  if (!source) return <div className="fixed inset-0 z-[60] grid place-items-center bg-navy-deep text-cream"><p className="font-pixel t-10">Entering the private rollup…</p></div>;
  const mine = brokerByNum(species[role === 'host' ? 0 : 1]);
  return (
    <>
      <PhaserMount routeId={mine.routeId} speciesId={mine.id} duelSource={source} onExit={onExit} />
      <SealedProofDock source={source} />
    </>
  );
}
