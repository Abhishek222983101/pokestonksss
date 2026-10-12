'use client';

import { use, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { useRouter } from 'next/navigation';
import { PublicKey } from '@solana/web3.js';
import { useChain } from '../../../lib/chain/store';
import { joinDuel, parseToken } from '../../../lib/chain/duel';
import { getClient } from '../../../lib/chain/config';
import { BROKERMON } from '../../../lib/brokermon';
import { useSessionStore } from '../../stores/sessionStore';
import OnboardingOverlay from '../../components/chain/OnboardingOverlay';
import DuelStage from '../../components/chain/DuelStage';
import { Button, Panel } from '../../components/ui';
import { Portrait } from '../../components/Portrait';

/** Invite landing page: guest identity is created automatically, then one tap to join. */
export default function DuelInvitePage({ params }: { params: Promise<{ host: string }> }) {
  const { host: hostStr } = use(params);
  const status = useChain((s) => s.status);
  const boot = useChain((s) => s.boot);
  const playAsGuest = useSessionStore((s) => s.playAsGuest);
  const [mine, setMine] = useState(1);
  const router = useRouter();
  const hash = useSyncExternalStore(() => () => {}, () => window.location.hash, () => '');
  const token = useMemo(() => parseToken(hash), [hash]);
  const [hostSpecies, setHostSpecies] = useState<number | null>(null);
  const [joined, setJoined] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    playAsGuest();
    void boot();
    (async () => {
      try {
        const a = await getClient().getArena(new PublicKey(hostStr));
        if (a) setHostSpecies(a.match.sides[0].species);
      } catch { /* shown below */ }
    })();
  }, [hostStr, boot, playAsGuest]);

  let host: PublicKey | null = null;
  try { host = new PublicKey(hostStr); } catch { /* invalid */ }
  if (!host || (hash !== '' && !token)) return <main className="p-8"><Panel><p>This invite link looks broken. Ask your friend for a new one.</p></Panel></main>;
  if (joined && hostSpecies !== null) {
    return <DuelStage role="guest" host={host} hostSpecies={hostSpecies} guestSpecies={mine} opponent={host} onExit={() => router.push('/')} />;
  }
  const join = async () => {
    if (hostSpecies === null || !token) return;
    setBusy(true); setErr(null);
    try { await joinDuel(host!, hostSpecies, mine, token); setJoined(true); }
    catch (e) { setErr(String((e as Error).message)); setBusy(false); }
  };
  return (
    <main className="mx-auto max-w-xl p-4 sm:p-8">
      <OnboardingOverlay />
      <h1 className="font-pixel t-16 text-navy mb-2">You were challenged!</h1>
      <p className="mb-4 text-sm">A friend invited you to a sealed duel on MagicBlock devnet. No wallet needed. Pick your BrokerMon and join.</p>
      <Panel className="mb-4">
        <div role="radiogroup" aria-label="Choose your BrokerMon" className="grid grid-cols-4 gap-2">
          {BROKERMON.map((b) => {
            const on = mine === b.num;
            return (
              <button key={b.id} role="radio" aria-checked={on} onClick={() => setMine(b.num)}
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
      <Button onClick={join} disabled={busy || status !== 'ready' || hostSpecies === null}>{busy ? 'Joining…' : status !== 'ready' ? 'Setting up…' : hostSpecies === null ? 'Looking for the duel…' : 'Join duel'}</Button>
    </main>
  );
}
