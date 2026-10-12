/**
 * Sealed duel on the MagicBlock Private ER (TEE), devnet end to end:
 * base setup (create, join, VRF seed, delegate to the TEE) -> private permissions -> sealed picks -> resolve -> commit to Solana.
 * Also proves privacy (a non-member reads null), recomputes every roll from the public log and replays the match.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Keypair } from "@solana/web3.js";
import { SEALED, SealedClient, deriveRoll, keypairSigner } from "@pokestonksss/sdk";
import { init as initRules, replay } from "@pokestonksss/rules-wasm";
import { airdrop, makeClient, sleep } from "./lib/play";

let failed = false;
const ok = (label: string, pass: boolean, detail = "") => { console.log(`${pass ? "✓" : "✗"} ${label} ${detail}`); if (!pass) failed = true; };
const t0 = Date.now();
const lap = (s: string) => console.log(`  [${((Date.now() - t0) / 1000).toFixed(1)}s] ${s}`);
const hex = (b: ArrayLike<number>) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

(async () => {
  await initRules(readFileSync(resolve(__dirname, "../packages/rules-wasm/pkg/duel_wasm_bg.wasm")));
  const game = makeClient();
  const sealed = new SealedClient(game);
  const H = Keypair.generate(), G = Keypair.generate(), X = Keypair.generate();
  const hs = keypairSigner(H), gs = keypairSigner(G), xs = keypairSigner(X);
  await Promise.all([airdrop(game, H.publicKey, 0.05), airdrop(game, G.publicKey, 0.05), airdrop(game, X.publicKey, 0.01)]);
  const host = H.publicKey;
  const players: [typeof host, typeof host] = [H.publicKey, G.publicKey];
  lap("match keys funded");

  // ---- base layer setup
  const token = SealedClient.newToken();
  const c = await sealed.create(hs, 0, token); lap(`create ${c.link}`);
  try { await sealed.join(gs, host, 1, new Uint8Array(32)); ok("join with a wrong token is rejected", false); } catch { ok("join with a wrong token is rejected", true); }
  const j = await sealed.join(gs, host, 1, token); lap(`join ${j.link}`);
  const seedTx = await sealed.requestSeed(hs, host); lap(`request_seed (MagicBlock VRF, base layer) ${seedTx.link}`);
  const seeded = await sealed.waitSeeded(host);
  ok("VRF seed landed on the base layer", seeded.status === SEALED.SEEDED && /[1-9a-f]/.test(seeded.seed), `seed ${seeded.seed.slice(0, 16)}…`); lap("seed callback");
  const del = await sealed.delegateAll(hs, host, players); lap(`delegate duel + 2 picks to the TEE ${del.link}`);

  // ---- TEE: auth, clone, permissions
  const [th, tg] = await Promise.all([sealed.connect(H), sealed.connect(G)]);
  lap("TEE auth tokens (challenge signed by each match key)");
  await sealed.waitCloned(th.conn, host, players); lap("accounts cloned into the TEE");
  const op = await sealed.open(th.conn, hs, host, players); lap(`open (private permissions on both picks) ${op.link}`);
  const permsOk = await sealed.waitPermissions([th.conn, tg.conn], host, players);
  ok("each pick has a PRIVATE permission on the TEE that lists only its owner", permsOk);
  const pa = await sealed.readPermission(th.conn, sealed.pick(host, H.publicKey));
  const pb = await sealed.readPermission(tg.conn, sealed.pick(host, G.publicKey));
  ok("the host cannot even read the guest's permission account", !(await sealed.readPermission(th.conn, sealed.pick(host, G.publicKey))).exists);
  ok("host pick: members = [host match key]", pa.members.length === 1 && pa.members[0] === H.publicKey.toBase58(), JSON.stringify(pa.members));
  ok("guest pick: members = [guest match key]", pb.members.length === 1 && pb.members[0] === G.publicKey.toBase58(), JSON.stringify(pb.members));

  // ---- sealed turns
  let turns = 0;
  let privacyChecked = false;
  const lockedSlots: number[][] = [];
  for (let g = 0; g < 20; g++) {
    const d = await sealed.readDuel(host, th.conn);
    if (!d || d.status !== SEALED.LIVE) break;
    const sH = Math.floor(Math.random() * 4), sG = Math.floor(Math.random() * 4);
    const nH = BigInt(Math.floor(Math.random() * 2 ** 48)), nG = BigInt(Math.floor(Math.random() * 2 ** 48));
    const [lh, lg] = await Promise.all([sealed.lock(th.conn, hs, host, sH, nH), sealed.lock(tg.conn, gs, host, sG, nG)]);
    lockedSlots.push([sH, sG]);
    if (!privacyChecked) {
      privacyChecked = true;
      const mine = await sealed.peekPick(th.conn, host, H.publicKey);
      const theirsAsHost = await sealed.peekPick(th.conn, host, G.publicKey);
      const theirsAsGuest = await sealed.peekPick(tg.conn, host, H.publicKey);
      const anon = await sealed.peekPick(sealed.publicTee(), host, H.publicKey);
      const stranger = await sealed.connect(X);
      const asStranger = await sealed.peekPick(stranger.conn, host, H.publicKey);
      ok("host can read its own sealed pick", mine.visible && mine.slot === sH, JSON.stringify(mine));
      ok("host CANNOT read the guest's sealed pick", !theirsAsHost.visible);
      ok("guest CANNOT read the host's sealed pick", !theirsAsGuest.visible);
      ok("an anonymous visitor CANNOT read a sealed pick", !anon.visible);
      ok("an authenticated stranger CANNOT read a sealed pick", !asStranger.visible);
      const pub = await sealed.readDuel(host, th.conn);
      ok("the public duel state shows who locked, never what", pub?.lockedMask === 3 && pub.log.length === turns);
      lap(`lock ${lh.link}`);
    }
    // resolve must wait for a later slot than the last lock (blocks simulate-and-peek), then anyone can resolve
    let resolved = false;
    for (let i = 0; i < 12 && !resolved; i++) {
      try { await sealed.resolve(th.conn, hs, host, players); resolved = true; } catch { await sleep(250); }
    }
    ok(`turn ${turns + 1} resolved`, resolved);
    if (!resolved) break;
    turns++;
  }
  const fin = await sealed.readDuel(host, th.conn);
  ok("duel finished inside the TEE", fin?.status === SEALED.FINISHED, `turns ${turns}, winner seat ${fin?.winner}`);

  // ---- commit to Solana and verify
  const f = await sealed.finish(th.conn, hs, host, players); lap(`finish: commit + undelegate ${f.link}`);
  const onBase = await sealed.waitCommitted(host);
  ok("the finished duel is on Solana (undelegated, owned by our program)", onBase.status === SEALED.FINISHED);
  const seed = Uint8Array.from(Buffer.from(onBase.seed, "hex"));
  let rollsOk = true;
  onBase.log.forEach((t, i) => { const r = deriveRoll(seed, i, t.picks, t.nonces); if (hex(r).slice(0, 20) !== hex(t.rnd)) rollsOk = false; });
  ok("every roll recomputes from the public seed and the two sealed nonces", rollsOk && onBase.log.length === turns);
  ok("picks in the public log are the ones the players sealed", onBase.log.every((t, i) => t.picks[0] === lockedSlots[i][0] && t.picks[1] === lockedSlots[i][1]));
  const rp = replay(onBase.species, onBase.log.map((t) => ({ picks: t.picks, rnd: t.rnd, mood: [0, 0] })), [0, 0]);
  ok("replaying the log with the shared Rust rules reproduces the result", rp.ok && rp.winner === onBase.winner && rp.hp[0] === onBase.match.sides[0].hp && rp.hp[1] === onBase.match.sides[1].hp, JSON.stringify(rp));
  console.log(`\nTotal ${((Date.now() - t0) / 1000).toFixed(1)} s. duel account: https://explorer.solana.com/address/${sealed.duel(host).toBase58()}?cluster=devnet`);
  console.log(failed ? "FAILED" : "ALL PASSED");
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
