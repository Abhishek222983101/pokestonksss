'use client';

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useSessionStore } from '../stores/sessionStore';
import { audio } from '../game/audio';
import { Logotype } from './Logotype';
import { Panel } from './ui';
import StartDialog from './chain/StartDialog';
import { useChain } from '../../lib/chain/store';
import { walletSession } from '../../lib/chain/guest';

interface Props {
  /** Persisted choices have been read; safe to decide where "Continue" goes. */
  ready: boolean;
  onContinue: () => void;
}

/**
 * Title screen. The wordmark hangs straight on the pixel field; the only surface is a navy dialog
 * with the menu, like a handheld's title menu: the blinking triangle marks the current choice.
 */
export default function Title({ ready, onContinue }: Props) {
  const guest = useSessionStore((s) => s.guest);
  const playAsGuest = useSessionStore((s) => s.playAsGuest);
  const signOut = useSessionStore((s) => s.signOut);
  const menuRef = useRef<HTMLDivElement>(null);
  const [setup, setSetup] = useState(false);
  const wallet = guest && typeof window !== 'undefined' ? walletSession() : null;

  // Keyboard players land on the first choice.
  useEffect(() => {
    const first = menuRef.current?.querySelector<HTMLButtonElement>('button:not([disabled])');
    first?.focus({ preventScroll: true });
  }, [guest, ready]);

  const onMenuKey = useCallback((e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('button:not([disabled])') ?? []);
    if (!items.length) return;
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = e.key === 'ArrowDown' ? (i + 1) % items.length : (i - 1 + items.length) % items.length;
    items[next].focus();
    audio.sfx('menu_move');
    e.preventDefault();
  }, []);

  const proceed = () => {
    audio.sfx('menu_select');
    onContinue();
  };

  return (
    <section
      aria-labelledby="title-heading"
      className="pointer-events-none flex h-full flex-col items-center justify-between px-3 pt-[max(7vh,1.5rem)] pb-[max(1rem,env(safe-area-inset-bottom))] short:flex-row short:justify-center short:gap-6 short:py-2"
    >
      <header className="w-[min(88vw,34rem)] short:w-[min(40vw,20rem)]">
        <h1 id="title-heading" className="m-0">
          <Logotype />
        </h1>
      </header>

      {setup && !guest ? (
        <StartDialog
          onGuest={() => { playAsGuest(); onContinue(); }}
          onWallet={() => { playAsGuest(); onContinue(); }}
          onClose={() => setSetup(false)}
        />
      ) : (
      <Panel tone="dialog" className="pointer-events-auto w-[min(100%_-_1rem,28rem)] short:w-[min(52vw,26rem)] short:py-2!" aria-label="Start menu">
        <p className="text-[17px] leading-snug short:text-[15px]">
          Pick a BrokerMon, battle other players, and climb from Shrimp to Whale on Solana devnet.
        </p>

        <div ref={menuRef} role="group" aria-label="Start" onKeyDown={onMenuKey} className="mt-3 -mx-2 short:mt-1">
          {guest ? (
            <>
              <button type="button" className="menu-item" onClick={proceed} disabled={!ready}>
                <span>
                  Continue
                  <small>{wallet ? `Wallet ${wallet.wallet.slice(0, 4)}…${wallet.wallet.slice(-4)}${wallet.walletName ? ` (${wallet.walletName})` : ''}` : 'Guest trainer on this device'}</small>
                </span>
              </button>
              <button
                type="button"
                className="menu-item"
                onClick={() => {
                  audio.sfx('menu_back');
                  useChain.getState().useGuest();
                  signOut();
                }}
              >
                <span>Start over<small>Pick another trainer or wallet</small></span>
              </button>
            </>
          ) : (
            <button type="button" className="menu-item" onClick={() => { audio.sfx('menu_select'); setSetup(true); }} disabled={!ready}>
              <span>
                Play
                <small>Guest in one click, or connect a Solana wallet to earn badge tokens.</small>
              </span>
            </button>
          )}
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-1 short:mt-1">
          <span className="chip chip-plain">devnet</span>
          <span className="chip chip-plain">Ephemeral Rollup</span>
        </div>
        <p className="mt-2 text-[13px] leading-snug text-cream/75 short:mt-1 short:text-[12px]">
          Test network only. Nothing here has cash value.
        </p>
      </Panel>
      )}
    </section>
  );
}
