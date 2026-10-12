'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { useSessionStore } from '../stores/sessionStore';
import { loadProfile, type Profile } from '../../lib/profile';
import { useChain } from '../../lib/chain/store';
import { getClient } from '../../lib/chain/config';
import { accountLink, trainerPda } from '@pokestonksss/sdk';
import { ownerKey } from '../../lib/chain/guest';
import { rankOf } from '../../lib/rank';
import { getBroker } from '../../lib/brokermon';
import { audio } from '../game/audio';
import { EventBus } from '../game/events';
import { Icon } from './Icon';
import { Portrait } from './Portrait';
import Toasts from './Toasts';
import { Button, Panel } from './ui';
import { AvatarFace } from './AvatarFace';
import StartDialog from './chain/StartDialog';
import RewardsPanel from './chain/RewardsPanel';
import { useRewards } from '../../lib/chain/rewards';
import { levelProgress } from '@pokestonksss/sdk';

function useMuted(): boolean {
  return useSyncExternalStore(
    (cb) => audio.onChange(cb),
    () => audio.isMuted(),
    () => false,
  );
}

/**
 * Always-on heads-up display (top right). Full on the globe; inside a route it shrinks to the mute toggle so
 * the game keeps its screen. The container ignores pointer events, only the controls take them.
 */
export default function Hud() {
  const playing = useSessionStore((s) => s.routeId !== null);
  const speciesId = useSessionStore((s) => s.speciesId);
  const setStage = useSessionStore((s) => s.setStage);
  const signOut = useSessionStore((s) => s.signOut);
  const muted = useMuted();
  const [local, setProfile] = useState<Profile>({ rating: 1000, wins: 0, losses: 0 });
  const trainer = useChain((s) => s.trainer);
  const refreshTrainer = useChain((s) => s.refreshTrainer);
  const identity = useChain((s) => s.identity);
  const address = useChain((s) => s.address);
  const claimedCount = useRewards((s) => s.claimed.length);
  const [dialog, setDialog] = useState<'wallet' | 'rewards' | null>(null);
  // On-chain Trainer is the source of truth once the rollup account exists; local profile only before that.
  const profile: Profile = trainer ? { rating: trainer.rating, wins: trainer.wins, losses: trainer.losses } : local;
  // Hidden during a battle: it would cover the turn timer.
  const [inBattle, setInBattle] = useState(false);

  useEffect(() => {
    const refresh = () => setProfile(loadProfile());
    refresh();
    const offs = [
      EventBus.on('battle:start', () => setInBattle(true)),
      EventBus.on('battle:closed', () => { setInBattle(false); refresh(); void refreshTrainer(); }),
      EventBus.on('game:exit', () => setInBattle(false)),
    ];
    return () => offs.forEach((off) => off());
  }, [refreshTrainer]);

  if (inBattle) return null;
  const mine = speciesId ? getBroker(speciesId) : null;

  return (
    <aside
      aria-label="Trainer and controls"
      className="pointer-events-none fixed top-0 right-0 z-40 flex max-w-full flex-col items-end p-1 pt-[max(0.25rem,env(safe-area-inset-top))] pr-[max(0.25rem,env(safe-area-inset-right))]"
    >
      {!playing && (
        <Panel tone="plate" className="pointer-events-auto p-2! short:p-1!">
          <div className="flex items-center gap-2">
            <AvatarFace avatar={trainer?.avatar ?? 0} size={32} />
            {mine && <Portrait speciesId={mine.id} size={32} title={mine.name} />}
            <div className="min-w-0">
              <p className="flex items-center gap-1">
                <span className="chip chip-plain" title={address ?? undefined}>{identity === 'wallet' ? `Wallet ${address?.slice(0, 4)}…${address?.slice(-4)}` : trainer ? 'Guest · on-chain' : 'Guest'}</span>
                <span className="font-pixel t-8">{rankOf(profile.rating)}</span>
              </p>
              <p className="mt-1 text-[14px] leading-tight text-slate">
                <span className="font-pixel t-10 text-ink tabular-nums">{profile.rating}</span> rating · {profile.wins}W {profile.losses}L
              </p>
              {trainer && (
                <a className="mt-1 block text-[12px] text-navy underline" target="_blank" rel="noreferrer" href={accountLink(trainerPda(ownerKey()).toBase58(), 'er', getClient().cfg)}>
                  your Trainer on Solana ↗
                </a>
              )}
              {trainer && mine && (() => {
                const lp = levelProgress(trainer.xp[mine.num] ?? 0);
                return <p className="mt-1 text-[12px] text-slate">{mine.name} Lv {lp.level + 1}{lp.toNext !== null ? ` · ${lp.toNext} xp to next` : ' · max'}</p>;
              })()}
              <p className="mt-1 flex flex-wrap gap-1">
                <button type="button" className="btn btn-sm" onClick={() => setDialog('rewards')}>Rewards{claimedCount ? ` (${claimedCount})` : ''}</button>
                <a className="btn btn-sm btn-secondary" href="/trainer">Trainer card</a>
                <a className="btn btn-sm btn-secondary" href="/leaderboard">Ranks</a>
                {identity === 'guest' ? (
                  <button type="button" className="btn btn-sm btn-secondary" onClick={() => setDialog('wallet')}>Connect wallet</button>
                ) : (
                  <button type="button" className="btn btn-sm btn-quiet" onClick={() => { useChain.getState().useGuest(); }}>Disconnect</button>
                )}
              </p>
            </div>
          </div>
        </Panel>
      )}

      <div className="pointer-events-auto flex items-center">
        <Button
          variant="quiet"
          small
          icon
          aria-pressed={muted}
          aria-label={muted ? 'Turn sound on' : 'Mute sound'}
          onClick={() => {
            audio.setMuted(!muted);
          }}
        >
          <Icon name={muted ? 'soundOff' : 'soundOn'} size={18} />
        </Button>
        {!playing && (
          <>
            <Button
              variant="quiet"
              small
              icon
              aria-label="Change broker"
              title="Change broker"
              onClick={() => {
                audio.sfx('menu_select');
                setStage('select');
              }}
            >
              <Icon name="swap" size={18} />
            </Button>
            <Button
              variant="quiet"
              small
              icon
              aria-label="Back to title"
              title="Back to title"
              onClick={() => {
                audio.sfx('menu_back');
                signOut();
              }}
            >
              <Icon name="power" size={18} />
            </Button>
          </>
        )}
      </div>

      <Toasts />
      {dialog && (
        <div className="pointer-events-auto fixed inset-0 z-50 grid place-items-center bg-navy-deep/70 p-2" onClick={(e) => { if (e.target === e.currentTarget) setDialog(null); }}>
          {dialog === 'rewards' ? <RewardsPanel onClose={() => setDialog(null)} /> : <StartDialog walletOnly onGuest={() => setDialog(null)} onWallet={() => setDialog(null)} onClose={() => setDialog(null)} />}
        </div>
      )}
    </aside>
  );
}
