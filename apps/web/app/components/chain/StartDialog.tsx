'use client';

import { useState } from 'react';
import type { Transaction } from '@solana/web3.js';
import { useWallet } from '@solana/wallet-adapter-react';
import { WalletReadyState } from '@solana/wallet-adapter-base';
import { AVATAR_NAMES } from '../../game/art';
import { audio } from '../../game/audio';
import { useChain } from '../../../lib/chain/store';
import { pendingAvatar, setPendingAvatar } from '../../../lib/chain/guest';
import { AvatarFace } from '../AvatarFace';
import { Button, Panel } from '../ui';

interface Props {
  /** "Play as guest" chosen (avatar already saved). */
  onGuest: () => void;
  /** A wallet was linked (the chain store is already `ready`). */
  onWallet: () => void;
  onClose?: () => void;
  /** Hide the guest option (used when switching a guest session to a wallet). */
  walletOnly?: boolean;
}

/** Choose a trainer look, then play instantly as a guest or connect a Solana wallet (one approval, then no popups). */
export default function StartDialog({ onGuest, onWallet, onClose, walletOnly }: Props) {
  const { wallets } = useWallet();
  const connectWallet = useChain((s) => s.connectWallet);
  const [avatar, setAvatar] = useState(() => (typeof window === 'undefined' ? 0 : pendingAvatar()));
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const installed = wallets.filter((w) => w.readyState === WalletReadyState.Installed || w.readyState === WalletReadyState.Loadable);

  const pick = (a: number) => { audio.sfx('menu_move'); setAvatar(a); setPendingAvatar(a); };

  const link = async (name: string) => {
    const entry = wallets.find((w) => w.adapter.name === name);
    if (!entry) return;
    setBusy(name); setErr(null);
    try {
      const ad = entry.adapter;
      if (!ad.connected) await ad.connect();
      const publicKey = ad.publicKey;
      const sign = (ad as unknown as { signTransaction?: (tx: Transaction) => Promise<Transaction> }).signTransaction;
      if (!publicKey || !sign) throw new Error('This wallet cannot sign transactions.');
      setPendingAvatar(avatar);
      const ok = await connectWallet({ publicKey, signTransaction: (tx) => sign.call(ad, tx) as Promise<typeof tx>, name }, avatar);
      if (ok) { audio.sfx('menu_select'); onWallet(); }
      else setErr(useChain.getState().error ?? 'Could not link the wallet.');
    } catch (e) {
      const m = String((e as Error)?.message ?? e);
      setErr(/reject|denied|cancel/i.test(m) ? 'Wallet request was cancelled. Nothing was changed.' : m.slice(0, 140));
    } finally { setBusy(null); }
  };

  return (
    <Panel tone="dialog" className="pointer-events-auto w-[min(100%_-_1rem,30rem)] on-navy" role="dialog" aria-label="Start playing">
      <h2 className="font-pixel t-12 text-yellow mb-2">Choose your trainer</h2>
      <div role="radiogroup" aria-label="Trainer look" className="grid grid-cols-6 gap-1">
        {AVATAR_NAMES.map((n, i) => (
          <button key={n} type="button" role="radio" aria-checked={avatar === i} title={n} onClick={() => pick(i)}
            className={`grid place-items-center rounded-sm p-1 ${avatar === i ? 'bg-yellow/25 outline outline-2 outline-yellow' : 'bg-navy-deep/60 hover:bg-navy-deep'}`}>
            <AvatarFace avatar={i} size={36} title={n} />
          </button>
        ))}
      </div>
      <p className="mt-1 font-pixel t-8 text-cream/80 text-center">{AVATAR_NAMES[avatar]}</p>

      {!walletOnly && (
        <button type="button" className="menu-item mt-3" onClick={() => { setPendingAvatar(avatar); audio.sfx('menu_select'); onGuest(); }} disabled={!!busy}>
          <span>Play as guest<small>Instant. No wallet, no popups, free devnet SOL.</small></span>
        </button>
      )}

      <p className="mt-3 font-pixel t-8 text-cream/80">Or connect a Solana wallet</p>
      <p className="text-[13px] text-cream/75 leading-snug">One approval creates your trainer, moves it onto the MagicBlock rollup and registers a session key. After that, no popups while you fight, and your badges land in your wallet.</p>
      <div className="mt-1 -mx-2">
        {installed.length === 0 && (
          <p className="px-2 py-1 text-[14px] text-cream/90">No Solana wallet found in this browser. Install <a className="underline text-sky" href="https://phantom.app" target="_blank" rel="noreferrer">Phantom</a> or Solflare, or play as a guest.</p>
        )}
        {installed.map((w) => (
          <button key={w.adapter.name} type="button" className="menu-item" onClick={() => void link(w.adapter.name)} disabled={!!busy}>
            <span className="flex items-center gap-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={w.adapter.icon} alt="" width={20} height={20} />
              {busy === w.adapter.name ? 'Waiting for your wallet…' : w.adapter.name}
              <small>Set your wallet to Devnet. Test SOL only.</small>
            </span>
          </button>
        ))}
      </div>
      {err && <p role="alert" className="mt-2 text-sm text-yellow">{err}</p>}
      {onClose && <div className="mt-2"><Button variant="quiet" small onClick={onClose}>Back</Button></div>}
    </Panel>
  );
}
