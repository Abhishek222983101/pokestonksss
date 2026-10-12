'use client';

import { useState } from 'react';
import { PROGRAM_ID, accountLink } from '@pokestonksss/sdk';
import { useSealedProof } from '../../../lib/chain/sealedProof';
import { getClient } from '../../../lib/chain/config';
import { getSealed } from '../../../lib/chain/sealed';
import type { SealedDuelSource } from '../../../lib/chain/SealedDuelSource';

const A = ({ href, children }: { href: string; children: React.ReactNode }) => (
  <a className="underline text-sky break-all" target="_blank" rel="noreferrer" href={href}>{children} ↗</a>
);
function Row({ tag, title, why, children }: { tag: string; title: string; why: string; children: React.ReactNode }) {
  return (
    <li className="border-t border-slate/40 pt-2">
      <p className="font-pixel t-8 text-yellow">{tag} · {title}</p>
      <p className="text-[12px] text-cream/80 mb-1">{why}</p>
      <div className="text-[12px] space-y-0.5">{children}</div>
    </li>
  );
}

/** Proof layer for a Private ER duel: TEE, private permission, peek proof, VRF seed, sealed picks, commit to Solana. */
export default function SealedProofDock({ source }: { source: SealedDuelSource | null }) {
  const [open, setOpen] = useState(false);
  const [peeking, setPeeking] = useState(false);
  const { duel, host, seed, steps, myPermission, peek, committed } = useSealedProof();
  const cfg = getClient().cfg;
  const sealed = getSealed();
  const locks = steps.filter((s) => s.id.startsWith('lock'));
  const rolls = steps.find((s) => s.id === 'rolls');
  const chip = (on: boolean) => `panel panel-flat !m-0 !px-2 !py-1 font-pixel t-8 ${on ? 'text-ink' : 'text-slate-soft opacity-70'}`;
  const doPeek = async () => { if (!source) return; setPeeking(true); try { await source.peek(); } finally { setPeeking(false); } };
  return (
    <div className="pointer-events-none fixed left-2 top-1 z-[70] max-w-[calc(100vw-1rem)]">
      <div className="pointer-events-auto flex items-stretch gap-1">
        <div className="panel panel-dialog on-navy !m-0 !py-1 !px-2 text-cream">
          <div className="flex flex-wrap items-center gap-2" aria-label="Private ER proof strip">
            <span className="font-pixel t-8 text-green" title="This duel runs inside a MagicBlock Private Ephemeral Rollup (Intel TDX TEE)">● PRIVATE ER · TEE</span>
            <span className={chip(!!seed)} title="MagicBlock VRF seed, written on the base layer before the duel">VRF seed {seed ? '✓' : '…'}</span>
            <span className={chip(!!myPermission?.isPrivate)} title="Your pick lives in an account only your match key can read">Private pick {myPermission?.isPrivate ? '✓' : '…'}</span>
            <span className={chip(locks.length > 0)} title="Sealed picks sent to the TEE">Sealed ×{locks.length}</span>
            <span className={chip(!!committed)} title="Final result committed to Solana">Committed {committed ? <a href={committed.link} target="_blank" rel="noreferrer" className="underline">↗</a> : '…'}</span>
          </div>
        </div>
        <button className="btn btn-sm !m-0" onClick={() => setOpen((o) => !o)} aria-expanded={open}>{open ? 'Close' : 'Proof'}</button>
      </div>
      {open && (
        <div className="pointer-events-auto panel panel-dialog on-navy mt-2 !m-0 max-h-[78vh] w-[min(36rem,calc(100vw-1rem))] overflow-y-auto text-cream" role="dialog" aria-label="Proof of the private duel">
          <h2 className="font-pixel t-12 text-yellow mb-1">Verify this private duel</h2>
          <p className="text-[12px] mb-2">Your pick is written into an account that only your one-time match key can read. Not the opponent, not a spectator, not us. Try it below.</p>
          <ul className="space-y-2">
            <Row tag="PRIVATE ER" title="MagicBlock TEE rollup (Intel TDX)" why="The duel runs inside a trusted execution environment. Account reads are authorised per account by an on-chain permission.">
              <div>Endpoint {sealed.teeHttp}</div>
              <div>Program <A href={accountLink(PROGRAM_ID.toBase58(), 'base', cfg)}>{PROGRAM_ID.toBase58().slice(0, 12)}…</A>{duel && <> · Duel account <A href={accountLink(duel, 'base', cfg)}>{duel.slice(0, 12)}…</A></>}</div>
            </Row>
            <Row tag="PERMISSION" title="Who can read my pick" why="Created inside the TEE by our program. The member list is derived on chain from the pick's owner, never supplied by a client.">
              {myPermission ? (
                <>
                  <div>Pick account <A href={`https://explorer.solana.com/address/${myPermission.account}?cluster=custom&customUrl=${encodeURIComponent(sealed.teeHttp)}`}>{myPermission.account.slice(0, 12)}…</A></div>
                  <div>{myPermission.isPrivate ? 'Private' : 'PUBLIC (unexpected)'} · members: {myPermission.members.map((m) => `${m.slice(0, 6)}…`).join(', ') || 'none'} <span className="text-cream/60">(your match key)</span></div>
                </>
              ) : <div>Reading the permission…</div>}
            </Row>
            <Row tag="PEEK PROOF" title="Try to read the opponent's sealed pick" why="Reads their pick account with your own TEE login, and again with no login at all. A non-member gets nothing back.">
              <div><button type="button" className="btn btn-sm" disabled={!source || peeking} onClick={() => void doPeek()}>{peeking ? 'Probing…' : 'Peek at my opponent'}</button></div>
              {peek && (
                <div className="mt-1">
                  <div>My own pick: {peek.mine ? <b className="text-green">readable</b> : <b>not visible</b>}</div>
                  <div>Opponent pick, with my login: {peek.theirs ? <b className="text-yellow">LEAK</b> : <b className="text-green">denied (null)</b>}</div>
                  <div>My pick, with no login: {peek.anon ? <b className="text-yellow">LEAK</b> : <b className="text-green">denied (null)</b>}</div>
                </div>
              )}
            </Row>
            <Row tag="VRF" title="MagicBlock verifiable randomness" why="One seed from the base-layer VRF queue, requested before the duel went private. Each turn's roll mixes it with both players' sealed nonces, so nobody can predict or grind it.">
              {steps.filter((s) => s.id === 'seed').map((s) => <div key={s.id}><A href={s.link!}>{s.label}</A></div>)}
              {seed && <div className="font-mono break-all">seed 0x{seed.slice(0, 32)}…</div>}
              {rolls?.note && <div className="font-mono break-all">{rolls.note}</div>}
            </Row>
            <Row tag="STEPS" title="Every transaction" why="Base layer steps settle on Solana devnet. TEE steps run in the private rollup.">
              {steps.filter((s) => s.link).map((s) => <div key={s.id}>{s.label}{s.ms ? ` (${s.ms} ms)` : ''} · <A href={s.link!}>tx</A></div>)}
              {steps.filter((s) => !s.link).map((s) => <div key={s.id}>{s.label}{s.note ? ` · ${s.note}` : ''}</div>)}
            </Row>
            <Row tag="COMMIT" title="Result committed to Solana" why="When the duel ends the TEE commits the final state (winner and the full public log) to Solana and hands the accounts back.">
              <div>{committed ? <A href={committed.link}>finish: commit + undelegate</A> : 'Committed when the duel ends.'}</div>
              {host && <div><a className="underline text-sky" target="_blank" rel="noreferrer" href={`/verify/sealed/${host}`}>Replay it from the on-chain log (after it ends) ↗</a></div>}
            </Row>
          </ul>
        </div>
      )}
    </div>
  );
}
