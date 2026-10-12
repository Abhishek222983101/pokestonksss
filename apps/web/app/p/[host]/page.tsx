'use client';

import { use, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { useRouter } from 'next/navigation';
import { Keypair, PublicKey } from '@solana/web3.js';
import { SEALED, type TeeSession } from '@pokestonksss/sdk';
import { awaitLive, getSealed, joinSealed, parseSealedToken, type SetupStep } from '../../../lib/chain/sealed';
import { BROKERMON } from '../../../lib/brokermon';
import SealedDuelStage from '../../components/chain/SealedDuelStage';
import { Button, Panel, Spinner } from '../../components/ui';
import { Portrait } from '../../components/Portrait';

const STEP_TEXT: Record<SetupStep, string> = {
  seed: 'Waiting for the host to request the MagicBlock VRF seed…',
  delegate: 'Logging in to the TEE with your one-time match key…',
  tee: 'Logging in to the TEE…',
  open: 'Waiting for the private permissions to be created…',
  ready: 'Starting…',
};

/** Private duel invite: no wallet, no account. A one-time match key is created in this browser. */
export default function PrivateInvitePage({ params }: { params: Promise<{ host: string }> }) {
  const { host: hostStr } = use(params);
  const router = useRouter();
  const hash = useSyncExternalStore(() => () => {}, () => window.location.hash, () => '');
  const token = useMemo(() => parseSealedToken(hash), [hash]);
  const [mine, setMine] = useState(1);
  const [hostSpecies, setHostSpecies] = useState<number | null>(null);
  const [step, setStep] = useState<SetupStep | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [game, setGame] = useState<{ kp: Keypair; tee: TeeSession; players: [PublicKey, PublicKey]; species: [number, number] } | null>(null);

  let host: PublicKey | null = null;
  try { host = new PublicKey(hostStr); } catch { /* invalid */ }

  useEffect(() => {
    if (!host) return;
    void (async () => {
      try {
        const d = await getSealed().readDuel(host, 'base');
        if (d) setHostSpecies(d.species[0]);
      } catch { /* shown below */ }
    })();
  }, [hostStr]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!host || (hash !== '' && !token)) return <main className="p-8"><Panel><p>This invite link looks broken. Ask your friend for a new one.</p></Panel></main>;
  if (game) return <SealedDuelStage role="guest" host={host} kp={game.kp} tee={game.tee} players={game.players} species={game.species} onExit={() => router.push('/')} />;

  const join = async () => {
    if (hostSpecies === null || !token || !host) return;
    setBusy(true); setErr(null);
    try {
      const d0 = await getSealed().readDuel(host, 'base');
      if (!d0 || d0.status !== SEALED.OPEN) throw new Error('This invite is no longer valid. Ask your friend for a new link.');
      const { kp } = await joinSealed(host, mine, token);
      const players: [PublicKey, PublicKey] = [host, kp.publicKey];
      const tee = await awaitLive(kp, host, players, setStep);
      setGame({ kp, tee, players, species: [hostSpecies, mine] });
    } catch (e) {
      const m = String((e as Error).message);
      setErr(/6003|BadToken|InviteExpired|WrongPhase|6001/i.test(m) ? 'This invite is no longer valid. Ask your friend for a new link.' : m.slice(0, 160));
      setBusy(false); setStep(null);
    }
  };

  return (
    <main className="mx-auto max-w-xl p-4 sm:p-8">
      <h1 className="font-pixel t-16 text-navy mb-2">Private duel invite</h1>
      <p className="mb-4 text-sm">A friend invited you to a sealed duel inside a MagicBlock <b>Private Ephemeral Rollup</b>. Your pick is hidden from everyone, including your opponent, until the turn resolves. No wallet needed: a one-time match key is created in this browser.</p>
      <Panel className="mb-4">
        <div role="radiogroup" aria-label="Choose your BrokerMon" className="grid grid-cols-4 gap-2">
          {BROKERMON.map((b) => {
            const on = mine === b.num;
            return (
              <button key={b.id} role="radio" aria-checked={on} onClick={() => setMine(b.num)} disabled={busy}
                className={`panel !m-0 !p-2 flex flex-col items-center gap-1 font-pixel t-8 ${on ? 'panel-dialog on-navy text-yellow' : 'panel-flat text-ink'}`}
                style={on ? { outline: '3px solid #d8a830', outlineOffset: 2 } : undefined}>
                <Portrait speciesId={b.id} size={48} title={b.name} />
                {b.ticker}
                <span className="text-[10px] font-body">{b.name}</span>
                {on && <span aria-hidden="true">▲ you</span>}
              </button>
            );
          })}
        </div>
      </Panel>
      {err && <p role="alert" className="mb-2 text-sm text-red-deep">{err}</p>}
      <Button onClick={join} disabled={busy || hostSpecies === null}>{busy ? 'Joining…' : hostSpecies === null ? 'Looking for the duel…' : 'Join private duel'}</Button>
      {step && <p className="mt-3 font-pixel t-8 flex items-center gap-2"><Spinner /> {STEP_TEXT[step]}</p>}
    </main>
  );
}
