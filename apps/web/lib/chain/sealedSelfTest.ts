import { Keypair } from '@solana/web3.js';
import { SEALED, SealedClient, deriveRoll, keypairSigner } from '@pokestonksss/sdk';
import { rules, type Mood, type Slot } from '../rules';
import { fundKey, getSealed } from './sealed';

export interface SelfTestRow { name: string; ok: boolean | null; detail: string; link?: string }
const hex = (a: ArrayLike<number>) => Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * One-click Private ER proof, no second browser needed: two throwaway match keys play a full sealed duel inside the
 * MagicBlock TEE, a third key and an anonymous visitor try to read the sealed picks, then every roll is recomputed
 * from the public VRF seed and the replay is compared with the state committed to Solana.
 */
export async function runSealedSelfTest(push: (r: SelfTestRow) => void): Promise<void> {
  const sealed = getSealed();
  const t0 = performance.now();
  const lap = () => `${((performance.now() - t0) / 1000).toFixed(1)} s`;
  const H = Keypair.generate(), G = Keypair.generate(), X = Keypair.generate();
  const hs = keypairSigner(H), gs = keypairSigner(G), xs = keypairSigner(X);
  const host = H.publicKey;
  const players: [typeof host, typeof host] = [H.publicKey, G.publicKey];
  void xs;
  await Promise.all([fundKey(H.publicKey), fundKey(G.publicKey)]);
  push({ name: 'Two one-time match keys created and funded (no wallet, no link to you)', ok: true, detail: `host ${H.publicKey.toBase58().slice(0, 8)}… guest ${G.publicKey.toBase58().slice(0, 8)}… · ${lap()}` });

  const token = SealedClient.newToken();
  const c = await sealed.create(hs, 0, token);
  push({ name: 'create_duel on Solana (base layer)', ok: true, detail: `${c.ms} ms`, link: c.link });
  const j = await sealed.join(gs, host, 1, token);
  push({ name: 'join_duel with the invite token', ok: true, detail: `${j.ms} ms`, link: j.link });
  const rs = await sealed.requestSeed(hs, host);
  const seeded = await sealed.waitSeeded(host);
  push({ name: 'MagicBlock VRF seed written on the base layer (before the duel goes private)', ok: /[1-9a-f]/.test(seeded.seed), detail: `0x${seeded.seed.slice(0, 24)}…`, link: rs.link });
  const del = await sealed.delegateAll(hs, host, players);
  push({ name: 'Duel and both picks delegated to the Private Ephemeral Rollup (TEE validator)', ok: true, detail: `${del.ms} ms`, link: del.link });

  const [th, tg, tx] = await Promise.all([sealed.connect(H), sealed.connect(G), sealed.connect(X)]);
  push({ name: 'TEE login: each match key signs the challenge and receives a token', ok: true, detail: lap() });
  await sealed.waitCloned(th.conn, host, players);
  const op = await sealed.open(th.conn, hs, host, players);
  push({ name: 'open: private permissions created inside the TEE for both picks', ok: true, detail: `${op.ms} ms`, link: op.link });
  const ok = await sealed.waitPermissions([th.conn, tg.conn], host, players);
  const pa = await sealed.readPermission(th.conn, sealed.pick(host, H.publicKey));
  push({ name: 'Permission of the host pick lists only the host match key', ok: ok && pa.isPrivate && pa.members.length === 1, detail: `private ${pa.isPrivate} · members ${pa.members.map((m) => m.slice(0, 8) + '…').join(', ')}`, link: `https://explorer.solana.com/address/${sealed.pick(host, H.publicKey).toBase58()}?cluster=custom&customUrl=${encodeURIComponent(sealed.teeHttp)}` });

  const picks: number[][] = [];
  let leaked = false;
  for (let g = 0; g < 20; g++) {
    const d = await sealed.readDuel(host, th.conn);
    if (!d || d.status !== SEALED.LIVE) break;
    const sH = Math.floor(Math.random() * 4), sG = Math.floor(Math.random() * 4);
    const nH = BigInt(Math.floor(Math.random() * 2 ** 48)), nG = BigInt(Math.floor(Math.random() * 2 ** 48));
    await Promise.all([sealed.lock(th.conn, hs, host, sH, nH), sealed.lock(tg.conn, gs, host, sG, nG)]);
    picks.push([sH, sG]);
    if (g === 0) {
      const mine = await sealed.peekPick(th.conn, host, H.publicKey);
      const theirs = await sealed.peekPick(th.conn, host, G.publicKey);
      const guestSees = await sealed.peekPick(tg.conn, host, H.publicKey);
      const anon = await sealed.peekPick(sealed.publicTee(), host, H.publicKey);
      const stranger = await sealed.peekPick(tx.conn, host, H.publicKey);
      leaked = theirs.visible || guestSees.visible || anon.visible || stranger.visible;
      push({ name: 'Peek proof: the host reads its own sealed pick', ok: mine.visible, detail: mine.visible ? `slot ${mine.slot}, locked` : 'not visible' });
      push({ name: 'Peek proof: the host CANNOT read the guest\'s sealed pick', ok: !theirs.visible, detail: theirs.visible ? 'LEAK' : 'null (denied)' });
      push({ name: 'Peek proof: the guest CANNOT read the host\'s sealed pick', ok: !guestSees.visible, detail: guestSees.visible ? 'LEAK' : 'null (denied)' });
      push({ name: 'Peek proof: an anonymous visitor and an authenticated stranger CANNOT read it', ok: !anon.visible && !stranger.visible, detail: anon.visible || stranger.visible ? 'LEAK' : 'null (denied) for both' });
    }
    let resolved = false;
    for (let i = 0; i < 12 && !resolved; i++) { try { await sealed.resolve(th.conn, hs, host, players); resolved = true; } catch { await sleep(250); } }
    if (!resolved) break;
  }
  const fin = await sealed.readDuel(host, th.conn);
  push({ name: 'Duel played to the end inside the TEE', ok: fin?.status === SEALED.FINISHED, detail: `${picks.length} sealed turns · winner seat ${fin?.winner} · ${lap()}` });
  const f = await sealed.finish(th.conn, hs, host, players);
  push({ name: 'finish: committed to Solana and undelegated', ok: true, detail: `${f.ms} ms`, link: f.link });
  const onBase = await sealed.waitCommitted(host);
  push({ name: 'The finished duel is on Solana, owned by our program again', ok: onBase.status === SEALED.FINISHED, detail: `${onBase.log.length} turns in the public log`, link: `https://explorer.solana.com/address/${sealed.duel(host).toBase58()}?cluster=devnet` });
  const seed = Uint8Array.from(Buffer.from(onBase.seed, 'hex'));
  const rollsOk = onBase.log.every((t, i) => hex(deriveRoll(seed, i, t.picks, t.nonces)).slice(0, 20) === hex(t.rnd));
  push({ name: 'Every roll recomputes from the VRF seed and both sealed nonces', ok: rollsOk, detail: 'sha256(seed, turn, picks, nonceA, nonceB)' });
  let state = rules.newMatch(onBase.species[0], onBase.species[1]);
  for (const t of onBase.log) { const rnd = new Uint8Array(32); rnd.set(t.rnd); state = rules.resolveTurn(state, t.picks as [Slot, Slot], rnd, [0, 0] as [Mood, Mood]).state; }
  const replayOk = state.fighters[0].hp === onBase.match.sides[0].hp && state.fighters[1].hp === onBase.match.sides[1].hp;
  push({ name: 'Replay with the shared Rust rules reproduces the committed result', ok: replayOk && !leaked, detail: `hp ${state.fighters[0].hp}/${state.fighters[1].hp}`, link: `/verify/sealed/${host.toBase58()}` });
}
