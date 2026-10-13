'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { PROGRAM_ID } from '@pokestonksss/sdk';
import { Panel } from '../components/ui';

const REPO = 'https://github.com/Abhishek222983101/pokestonksss';
const VIDEO = '/demo/demo.mp4';
const PID = PROGRAM_ID.toBase58();

const A = ({ href, children }: { href: string; children: React.ReactNode }) => (
  <a className="underline text-navy" target={href.startsWith('/') ? undefined : '_blank'} rel="noreferrer" href={href}>{children}{href.startsWith('/') ? '' : ' ↗'}</a>
);
function Step({ n, title, children, proves }: { n: string; title: React.ReactNode; children: React.ReactNode; proves?: string }) {
  return (
    <li className="flex gap-3">
      <span className="font-pixel t-12 text-navy shrink-0 w-6">{n}</span>
      <div className="min-w-0">
        <p className="font-medium">{title}</p>
        <div className="text-sm text-slate space-y-1">{children}</div>
        {proves && <p className="mt-1 text-[12px]"><span className="chip chip-plain">proves</span> {proves}</p>}
      </div>
    </li>
  );
}

/** Judges window: the demo video (with download), a spoon-fed test path, and where each MagicBlock primitive is proven. */
export default function JudgesPage() {
  const [hasVideo, setHasVideo] = useState<boolean | null>(null);
  useEffect(() => { fetch(VIDEO, { method: 'HEAD' }).then((r) => setHasVideo(r.ok && (r.headers.get('content-type') ?? '').includes('video')), () => setHasVideo(false)); }, []);

  return (
    <main className="mx-auto max-w-3xl p-4 sm:p-8">
      <h1 className="font-pixel t-16 text-navy mb-1">Judges: start here</h1>
      <p className="mb-4 text-sm">PokeStonksss is a crypto creature battler where MagicBlock rollups are the whole game server. This page is the fastest way to see everything work. No wallet is needed for any step. Devnet only.</p>

      <Panel className="mb-4">
        <h2 className="font-pixel t-10 mb-2">1. Watch the demo (2 to 3 minutes)</h2>
        {hasVideo ? (
          <>
            <video className="w-full" controls preload="metadata" poster="/demo/poster.jpg" src={VIDEO} />
            <p className="mt-2 flex flex-wrap items-center gap-2">
              <a className="btn btn-sm" href={VIDEO} download="PokeStonksss-demo.mp4">Download the video (.mp4)</a>
              <span className="text-[12px] text-slate">Free to use in edits, posts and clips.</span>
            </p>
          </>
        ) : (
          <p className="text-sm text-slate">{hasVideo === null ? 'Loading…' : 'The demo video is being uploaded. In the meantime, steps 2 to 4 below take about five minutes and show everything live.'}</p>
        )}
      </Panel>

      <Panel className="mb-4">
        <h2 className="font-pixel t-10 mb-2">2. Quick start (30 seconds, one click)</h2>
        <ul className="space-y-2 text-sm">
          <li><Link className="btn btn-sm" href="/?demo=1">Play the judge demo</Link> You face a Dummy House Agent that never attacks, so any attack wins in 2 to 4 turns and you see the whole flow end to end.</li>
          <li><Link className="btn btn-sm btn-secondary" href="/selftest">Run the self-tests</Link> Two buttons: a real practice battle, and a full <b>Private ER</b> sealed duel with the privacy proofs. Every row links to the explorer.</li>
        </ul>
      </Panel>

      <Panel className="mb-4">
        <h2 className="font-pixel t-10 mb-2">3. The Private ER, step by step (the main event)</h2>
        <p className="text-sm mb-2">The idea: in a 1v1 duel both players pick a move at the same time. On a normal chain the second player can read the first player&apos;s pick. Here each pick is written into an account that only its owner&apos;s one-time key can read, inside a MagicBlock <b>Private Ephemeral Rollup (Intel TDX)</b>.</p>
        <p className="text-sm font-medium mb-1">Fastest: one click, one browser</p>
        <ol className="space-y-3 mb-4">
          <Step n="a" title={<>Open <A href="/selftest">/selftest</A> and press <b>Run Private ER self-test</b></>} proves="the whole Private ER pipeline works from a browser in about 30 seconds">
            <p>It creates two throwaway match keys and plays a full duel. Watch the rows turn green.</p>
          </Step>
          <Step n="b" title="Read the four Peek proof rows" proves="privacy is enforced by the rollup, not by our UI">
            <p>The host reads its own sealed pick. The host cannot read the guest&apos;s. The guest cannot read the host&apos;s. An anonymous visitor and a logged in stranger get nothing back (null).</p>
          </Step>
          <Step n="c" title="Open the explorer links on the permission and commit rows" proves="the permission is on chain and the final result is on Solana">
            <p>The permission account lists exactly one member: the pick&apos;s owner. The final duel account is owned by our program again with the full turn log.</p>
          </Step>
          <Step n="d" title="Open the last row (replay)" proves="every dice roll is fair">
            <p>Each roll is sha256 of the MagicBlock VRF seed plus both players&apos; sealed nonces. The page recomputes all of them and replays the match with the same Rust rules the program uses.</p>
          </Step>
        </ol>
        <p className="text-sm font-medium mb-1">Real thing: two browsers (about 2 minutes)</p>
        <ol className="space-y-3">
          <Step n="a" title={<>Browser A: open the <A href="/?demo=1">game</A>, Play as guest, pick a BrokerMon, press <b>Duel a friend</b></>}>
            <p><b>Private duel</b> is selected by default. A QR code and an invite link appear.</p>
          </Step>
          <Step n="b" title="Browser B (or a phone): open the invite link, pick a BrokerMon, press Join private duel">
            <p>Setup takes about 7 seconds: join, VRF seed, delegation to the TEE, TEE login, private permissions.</p>
          </Step>
          <Step n="c" title="Both play with Enter (FIGHT, then a move)" proves="sealed simultaneous moves and a shared turn clock">
            <p>You see OPPONENT LOCKED IN as soon as the other side seals, but never what they picked.</p>
          </Step>
          <Step n="d" title="Press Proof, then Peek at my opponent" proves="a live privacy test from inside a real match">
            <p>Your own pick is readable, the opponent&apos;s pick and an anonymous read both return null.</p>
          </Step>
          <Step n="e" title="After the result, press Proof and open the replay link" proves="the result is committed to Solana and verifiable">
            <p>Or open <code>/verify/sealed/&lt;match key&gt;</code> directly.</p>
          </Step>
        </ol>
      </Panel>

      <Panel className="mb-4">
        <h2 className="font-pixel t-10 mb-2">4. The rest of the MagicBlock stack in the normal game</h2>
        <p className="text-sm mb-2">Start the <A href="/?demo=1">judge demo</A>, play to the first win, and press <b>Proof</b> during the battle.</p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left font-pixel t-8"><th className="pr-2">Primitive</th><th className="pr-2">What it does here</th><th>Where to see proof</th></tr></thead>
            <tbody className="align-top">
              <tr><td className="pr-2 py-1">Ephemeral Rollup</td><td className="pr-2">Every move is a rollup transaction, about 250 ms, no server</td><td>Proof &gt; ROLLUP, every tx link</td></tr>
              <tr><td className="pr-2 py-1">VRF</td><td className="pr-2">One roll per turn, requested after both picks lock</td><td>Proof &gt; VRF (random bytes per turn)</td></tr>
              <tr><td className="pr-2 py-1">Price oracle</td><td className="pr-2">Price move since the bell changes damage by 10%</td><td>Proof &gt; ORACLE</td></tr>
              <tr><td className="pr-2 py-1">Session keys</td><td className="pr-2">Connect a wallet once, then no popups in a fight</td><td>Play &gt; Connect wallet, then Proof &gt; SESSION</td></tr>
              <tr><td className="pr-2 py-1">Crank</td><td className="pr-2">Settles a duel a player walked away from</td><td>Rollup duel &gt; Proof &gt; CRANK</td></tr>
              <tr><td className="pr-2 py-1">Commit to Solana</td><td className="pr-2">Rating, XP and trophies are saved, then minted as tokens</td><td>Proof &gt; SAVED, Rewards panel</td></tr>
              <tr><td className="pr-2 py-1">Private ER (TEE)</td><td className="pr-2">Sealed picks nobody can read</td><td>Section 3 above</td></tr>
            </tbody>
          </table>
        </div>
        <p className="text-sm mt-3"><b>Rewards:</b> beating a BrokerMon captures its asset: a trophy token (for example $SUI) is minted to your wallet, XP levels the creature up, and it evolves at Lv 4 and Lv 7. Open <b>Rewards</b> on the globe screen. The tokens are devnet only.</p>
      </Panel>

      <Panel className="mb-4">
        <h2 className="font-pixel t-10 mb-2">Addresses and code</h2>
        <dl className="grid grid-cols-[9rem_1fr] gap-y-1 text-sm break-all">
          <dt className="font-pixel t-8">Program (devnet)</dt><dd><A href={`https://explorer.solana.com/address/${PID}?cluster=devnet`}>{PID}</A></dd>
          <dt className="font-pixel t-8">Private ER</dt><dd>https://devnet-tee.magicblock.app (validator MTEWGuqxUpYZGFJQcp8tLN7x5v9BSeoFHYWQQ3n3xzo)</dd>
          <dt className="font-pixel t-8">Repo</dt><dd><A href={REPO}>{REPO}</A></dd>
          <dt className="font-pixel t-8">Private ER code</dt><dd><A href={`${REPO}/blob/main/programs/pokestonksss/src/sealed.rs`}>programs/pokestonksss/src/sealed.rs</A></dd>
          <dt className="font-pixel t-8">Every claim, proven</dt><dd><A href={`${REPO}/blob/main/docs/PROOFS.md`}>docs/PROOFS.md</A></dd>
        </dl>
      </Panel>

      <Panel>
        <h2 className="font-pixel t-10 mb-2">If something looks off</h2>
        <ul className="text-sm list-disc pl-5 space-y-1">
          <li>Faucet busy: wait a minute and retry. Each tester gets a little devnet SOL for fees.</li>
          <li>Connecting Phantom: switch it to Devnet first (Settings, Developer Settings).</li>
          <li>A private duel stuck on &quot;Moving the duel into the private rollup&quot;: reload both browsers and start a new invite.</li>
          <li>Everything is on devnet. Nothing here has cash value.</li>
        </ul>
      </Panel>
    </main>
  );
}
