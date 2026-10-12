'use client';

import { useEffect, useState } from 'react';
import { useSessionStore } from '../../stores/sessionStore';
import { useChain } from '../../../lib/chain/store';
import { ChainBattleSource } from '../../../lib/chain/ChainBattleSource';
import { LocalBattleSource } from '../../../lib/localBattleSource';
import { setBattleSourceFactory } from '../../game/flow/encounterFlow';
import { EventBus } from '../../game/events';
import OnboardingOverlay from './OnboardingOverlay';
import ProofStrip from './ProofStrip';
import DuelHost from './DuelHost';

/**
 * Connects the finished offline game to MagicBlock: boots the guest identity (create + delegate), routes every
 * encounter to a practice battle on the Ephemeral Rollup, and shows the Proof Strip during battles.
 * If the chain is unreachable the game still works with an honestly-labelled offline practice.
 */
export default function ChainBridge() {
  const guest = useSessionStore((s) => s.guest);
  const status = useChain((s) => s.status);
  const boot = useChain((s) => s.boot);
  const [inBattle, setInBattle] = useState(false);

  useEffect(() => { if (guest) void boot(); }, [guest, boot]);

  useEffect(() => {
    if (status !== 'ready') return;
    setBattleSourceFactory(async (p, f) => {
      try {
        const s = new ChainBattleSource(p, f, 1);
        await s.ready();
        return s;
      } catch (e) {
        EventBus.emit('toast', { text: `${(e as Error).message} Playing offline practice (not on-chain).`, tone: 'bad' });
        return new LocalBattleSource(p, f);
      }
    });
    return () => setBattleSourceFactory((p, f) => new LocalBattleSource(p, f));
  }, [status]);

  useEffect(() => {
    const a = EventBus.on('battle:start', () => setInBattle(true));
    const b = EventBus.on('battle:closed', () => setInBattle(false));
    return () => { a(); b(); };
  }, []);

  return (
    <>
      {guest && status !== 'ready' && <OnboardingOverlay />}
      <DuelHost />
      {inBattle && status === 'ready' && (
        <div className="pointer-events-none fixed left-2 top-1 z-40 max-w-[calc(100vw-1rem)]">
          <div className="pointer-events-auto panel panel-dialog on-navy !m-0 !py-1 !px-2 text-cream"><ProofStrip compact /></div>
        </div>
      )}
    </>
  );
}
