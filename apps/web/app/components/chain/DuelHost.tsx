'use client';

import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { PublicKey } from '@solana/web3.js';
import { useChain } from '../../../lib/chain/store';
import { hostDuel } from '../../../lib/chain/duel';
import { ownerKey } from '../../../lib/chain/guest';
import { getBroker } from '../../../lib/brokermon';
import { useSessionStore } from '../../stores/sessionStore';
import { Button, Panel, Spinner } from '../ui';
import DuelStage from './DuelStage';
import SealedDuelStage from './SealedDuelStage';
import { hostSealed, openSealed, type SetupStep } from '../../../lib/chain/sealed';
import type { Keypair } from '@solana/web3.js';
import type { TeeSession } from '@pokestonksss/sdk';

/** "Duel a friend": opens an invite on the rollup, shows link + QR, and starts the sealed duel when a guest joins. */
export default function DuelHost() {
  const status = useChain((s) => s.status);
  const speciesId = useSessionStore((s) => s.speciesId);
  const stage = useSessionStore((s) => s.stage);
  const routeId = useSessionStore((s) => s.routeId);
  const [open, setOpen] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [guest, setGuest] = useState<{ key: string; species: number } | null>(null);
  const cancelRef = useRef<(() => Promise<unknown>) | null>(null);
  const [mode, setMode] = useState<'private' | 'public'>('private');
  const [phase, setPhase] = useState<SetupStep | 'waiting' | null>(null);
  const [sealedGame, setSealedGame] = useState<{ kp: Keypair; tee: TeeSession; players: [PublicKey, PublicKey]; species: [number, number] } | null>(null);

  const num = speciesId ? getBroker(speciesId).num : 0;

  useEffect(() => {
    if (!open) return;
    let dead = false;
    (async () => {
      try {
        if (mode === 'private') {
          const d = await hostSealed(num, window.location.origin);
          if (dead) { void d.cancel(); return; }
          cancelRef.current = d.cancel;
          setLink(d.link);
          setQr(await QRCode.toDataURL(d.link, { margin: 1, width: 220, color: { dark: '#183088', light: '#f8f8d0' } }));
          setPhase('waiting');
          const joined = await d.joined;
          if (dead) return;
          cancelRef.current = null;
          const players: [PublicKey, PublicKey] = [new PublicKey(joined.players[0]), new PublicKey(joined.players[1])];
          const tee = await openSealed(d.kp, players, (s) => { if (!dead) setPhase(s); });
          if (!dead) setSealedGame({ kp: d.kp, tee, players, species: [joined.species[0], joined.species[1]] });
          return;
        }
        const d = await hostDuel(num, window.location.origin);
        if (dead) { void d.cancel(); return; }
        cancelRef.current = d.cancel;
        setLink(d.link);
        setQr(await QRCode.toDataURL(d.link, { margin: 1, width: 220, color: { dark: '#183088', light: '#f8f8d0' } }));
        const a = await d.joined;
        if (!dead) setGuest({ key: a.guest, species: a.match.sides[1].species });
      } catch (e) { if (!dead) setErr(String((e as Error).message)); }
    })();
    return () => { dead = true; };
  }, [open, num, mode]);

  const close = () => { void cancelRef.current?.(); cancelRef.current = null; setOpen(false); setLink(null); setQr(null); setErr(null); setGuest(null); setPhase(null); setSealedGame(null); };

  if (status !== 'ready' || stage !== 'globe' || routeId) return null;
  if (sealedGame) {
    return <SealedDuelStage role="host" host={sealedGame.kp.publicKey} kp={sealedGame.kp} tee={sealedGame.tee} players={sealedGame.players} species={sealedGame.species} onExit={close} />;
  }
  if (guest) {
    return <DuelStage role="host" host={ownerKey()} hostSpecies={num} guestSpecies={guest.species} opponent={new PublicKey(guest.key)} onExit={close} />;
  }
  return (
    <>
      <div className="fixed bottom-[11.5rem] right-3 z-30 sm:bottom-24"><Button onClick={() => setOpen(true)}>Duel a friend</Button></div>
      {open && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-navy-deep/80 p-4" role="dialog" aria-modal="true" aria-label="Duel a friend">
          <Panel tone="dialog" className="w-full max-w-md on-navy">
            <h2 className="font-pixel t-14 text-yellow mb-2">Duel a friend</h2>
            <div role="radiogroup" aria-label="Duel type" className="mb-3 grid grid-cols-2 gap-2">
              {([['private', 'Private duel', 'Sealed picks inside a MagicBlock Private Ephemeral Rollup (TEE). Nobody can read your pick.'], ['public', 'Rollup duel', 'Fast public rollup, picks sealed by commit-reveal.']] as const).map(([k, t, d]) => (
                <button key={k} type="button" role="radio" aria-checked={mode === k} disabled={!!link} onClick={() => setMode(k)}
                  className={`panel !m-0 !p-2 text-left ${mode === k ? 'panel-plate' : 'panel-flat opacity-80'}`} style={mode === k ? { outline: '3px solid #d8a830', outlineOffset: 1 } : undefined}>
                  <span className="font-pixel t-8 block text-ink">{t}{k === 'private' ? ' ★' : ''}</span><span className="text-[12px] text-slate leading-snug">{d}</span>
                </button>
              ))}
            </div>
            <p className="text-sm text-cream mb-3">{mode === 'private' ? 'Send this link or QR. Your friend joins with a one-time match key; neither of you can see the other\'s pick, and every roll mixes a MagicBlock VRF seed with both sealed nonces.' : 'Send this link or QR. Your friend joins in two taps; picks are sealed so nobody can peek, and every roll is a MagicBlock VRF result.'}</p>
            {err && <p className="text-sm text-yellow mb-2" role="alert">{err}</p>}
            {!link && !err && <p className="font-pixel t-10 text-cream flex items-center gap-2"><Spinner /> {mode === 'private' ? 'Creating a one-time match key and the duel…' : 'Opening the duel on the rollup…'}</p>}
            {link && (
              <div className="flex flex-col items-center gap-3">
                {qr && /* eslint-disable-next-line @next/next/no-img-element */ <img src={qr} alt="Duel invite QR code" width={220} height={220} />}
                <input readOnly value={link} className="w-full bg-cream text-ink text-xs p-2" onFocus={(e) => e.currentTarget.select()} aria-label="Invite link" />
                <div className="flex gap-2">
                  <Button onClick={() => { void navigator.clipboard?.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>{copied ? 'Copied ✓' : 'Copy link'}</Button>
                </div>
                <p className="font-pixel t-8 text-cream flex items-center gap-2"><Spinner />{' '}
                  {phase === 'seed' ? 'Requesting the MagicBlock VRF seed…' : phase === 'delegate' ? 'Moving the duel into the private rollup…' : phase === 'tee' ? 'Logging in to the TEE…' : phase === 'open' ? 'Creating the private permissions…' : phase === 'ready' ? 'Starting…' : 'Waiting for your friend…'}</p>
              </div>
            )}
            <div className="mt-4"><Button variant="secondary" onClick={close}>{phase && phase !== 'waiting' ? 'Leave' : 'Cancel'}</Button></div>
          </Panel>
        </div>
      )}
    </>
  );
}
