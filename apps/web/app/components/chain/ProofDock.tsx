'use client';

import { useState } from 'react';
import { PROGRAM_ID, accountLink, arenaPda, trainerPda, FEEDS } from '@pokestonksss/sdk';
import { useProof } from '../../../lib/chain/proof';
import { getClient } from '../../../lib/chain/config';
import { guestKeypair } from '../../../lib/chain/guest';
import ProofStrip from './ProofStrip';

const A = ({ href, children }: { href: string; children: React.ReactNode }) => (
  <a className="underline text-sky break-all" target={href.startsWith('/') ? undefined : '_blank'} rel="noreferrer" href={href}>{children} ↗</a>
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

/** The always-available proof layer: strip + a "Proof" button that opens every verifiable artifact of the current battle. */
export default function ProofDock({ sealedMode }: { sealedMode?: string }) {
  const [open, setOpen] = useState(false);
  const { weighed, sealed, rolled, saved, start } = useProof();
  const cfg = getClient().cfg;
  const me = guestKeypair().publicKey;
  const usd = (raw: string) => (raw && raw !== '0' ? `$${(Number(raw) / 1e8).toLocaleString(undefined, { maximumFractionDigits: 4 })}` : '—');
  return (
    <div className="pointer-events-none fixed left-2 top-1 z-[70] max-w-[calc(100vw-1rem)]">
      <div className="pointer-events-auto flex items-stretch gap-1">
        <div className="panel panel-dialog on-navy !m-0 !py-1 !px-2 text-cream"><ProofStrip compact sealedMode={sealedMode} /></div>
        <button className="btn btn-sm !m-0" onClick={() => setOpen((o) => !o)} aria-expanded={open}>{open ? 'Close' : 'Proof'}</button>
      </div>
      {open && (
        <div className="pointer-events-auto panel panel-dialog on-navy mt-2 !m-0 max-h-[78vh] w-[min(34rem,calc(100vw-1rem))] overflow-y-auto text-cream" role="dialog" aria-label="Proof of every MagicBlock step">
          <h2 className="font-pixel t-12 text-yellow mb-1">Verify this battle</h2>
          <p className="text-[12px] mb-2">Nothing here is simulated. Each line links to a real transaction or account on Solana devnet / the MagicBlock rollup.</p>
          <ul className="space-y-2">
            <Row tag="PROGRAM" title="Our game program on Solana" why="All rules run on-chain; the browser only replays them.">
              <div><A href={accountLink(PROGRAM_ID.toBase58(), 'base', cfg)}>{PROGRAM_ID.toBase58()}</A></div>
              <div>Your Trainer: <A href={accountLink(trainerPda(me).toBase58(), 'er', cfg)}>{trainerPda(me).toBase58().slice(0, 12)}…</A> · Arena: <A href={accountLink(arenaPda(me).toBase58(), 'er', cfg)}>{arenaPda(me).toBase58().slice(0, 12)}…</A></div>
            </Row>
            <Row tag="ROLLUP" title="MagicBlock Ephemeral Rollup" why="Your accounts were delegated to a rollup validator, so every move confirms in about 250 ms with no wallet popup.">
              <div>{cfg.erHttp}</div>
              <div>{start ? <>Battle started: <A href={start.link}>start_practice {start.ms ? `(${start.ms} ms)` : ''}</A></> : 'Waiting for the battle to start…'}</div>
            </Row>
            <Row tag="VRF" title="MagicBlock verifiable randomness" why="One random roll per turn, requested only after both picks are locked, so nobody can predict or choose it.">
              {rolled.length === 0 && <div>No rolls yet.</div>}
              {rolled.map((r, i) => (
                <div key={i}>{r.label}{r.link ? <> · <A href={r.link}>tx</A></> : null}{r.rnd && <> · <span className="font-mono">0x{r.rnd.slice(0, 20)}…</span></>}</div>
              ))}
            </Row>
            <Row tag="ORACLE" title="MagicBlock real-time price feeds" why="Price move since the bell changes damage by ±10% (flat when the feed is idle).">
              {weighed ? (
                <div>Bell: {usd(weighed.snap[0])} / {usd(weighed.snap[1])} · Now: {usd(weighed.now[0])} / {usd(weighed.now[1])} · Mood {weighed.mood.map((m) => (m > 0 ? '▲ bull' : m < 0 ? '▼ bear' : '■ flat')).join(' / ')}</div>
              ) : <div>Waiting for a snapshot…</div>}
              <div>Feed accounts: {FEEDS.slice(0, 3).map((f) => <span key={f.toBase58()} className="mr-1"><A href={accountLink(f.toBase58(), 'er', cfg)}>{f.toBase58().slice(0, 6)}…</A></span>)} …</div>
            </Row>
            {sealed.length > 0 && (
              <Row tag="SEALED" title="Hidden simultaneous picks" why="Duel picks are committed as hashes first and revealed after both are in.">
                {sealed.map((r, i) => <div key={i}>{r.label} · <A href={r.link}>tx</A></div>)}
              </Row>
            )}
            <Row tag="SAVED" title="Committed back to Solana" why="Your rating and record are written from the rollup to Solana. There is no claim step.">
              <div>{saved ? <A href={saved.link}>commit_trainer ({saved.ms} ms)</A> : 'Saved after the battle ends.'}</div>
            </Row>
            <Row tag="VERIFY" title="Replay it yourself" why="Re-run the whole match from the on-chain log with the same Rust rules.">
              <div><A href={`/verify/${me.toBase58()}`}>Open the verify page</A> · <A href="/judge">Judge self-test</A></div>
            </Row>
          </ul>
        </div>
      )}
    </div>
  );
}
