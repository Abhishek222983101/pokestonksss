/** Devnet e2e: onboard → delegate → practice battle to KO on the ER (VRF per turn, oracle mood) → commit → drained (unfunded) guest check. */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { Keypair, SystemProgram } from "@solana/web3.js";
import { keypairSigner, trainerPda } from "@pokestonksss/sdk";
import { makeClient, newPlayer, playPracticeToEnd, sleep, stats } from "./lib/play";
import { sendBase } from "./lib/chain";
import { init as initRules, replay } from "@pokestonksss/rules-wasm";
import { readFileSync } from "node:fs";
void keypairSigner; void trainerPda;

const out: Record<string, unknown> = { at: new Date().toISOString() };
const log = (k: string, v: unknown) => { out[k] = v; console.log(`[${k}]`, typeof v === "string" ? v : JSON.stringify(v)); };

(async () => {
  const client = makeClient();
  const events: any[] = [];
  const p = await newPlayer(client, "guest", (e) => events.push(e));
  log("onboard", { totalMs: p.onboardMs, steps: events.map((e) => e.step) });
  const r = await playPracticeToEnd(client, p.signer, 0, 1, 1);
  log("start_practice", { ms: r.start.ms, link: r.start.link });
  log("lock_ms", stats(r.turns.map((t) => t.lockMs)));
  log("lock_to_resolved_ms", stats(r.turns.map((t) => t.resolveMs)));
  log("battle", { turns: r.turns.length, finished: r.arena.phase === 5, winner: r.arena.winner, snap: r.arena.snap.map(String), moods: r.arena.log.map((l) => l.mood.join("/")), hp: r.arena.match.sides.map((s) => s.hp) });
  r.turns.forEach((t, i) => console.log(`T${i} pick${t.pick} ${t.lockMs}+${t.resolveMs}ms ${t.link}`));
  await initRules(readFileSync(resolve(__dirname, "../packages/rules-wasm/pkg/duel_wasm_bg.wasm")));
  const rp = replay([r.arena.match.sides[0].species, r.arena.match.sides[1].species], r.arena.log.map((l) => ({ picks: l.picks, rnd: l.rnd, mood: l.mood })));
  const hpOnChain = r.arena.match.sides.map((s) => s.hp);
  const same = rp.ok && rp.hp[0] === hpOnChain[0] && rp.hp[1] === hpOnChain[1] && rp.winner === r.arena.winner;
  log("REPLAY_matches_chain", { same, replay: rp, chainHp: hpOnChain, chainWinner: r.arena.winner });
  if (!same) { console.error("REPLAY MISMATCH"); process.exit(1); }
  const c = await client.commitTrainer(p.signer);
  await sleep(4000);
  const bt = await client.getTrainer(p.kp.publicKey, "base");
  const et = await client.getTrainer(p.kp.publicKey, "er");
  log("commit", { link: c.link, ms: c.ms, baseTrainer: bt && { rating: bt.rating, w: bt.wins, l: bt.losses, battles: bt.battles }, erTrainer: et && { rating: et.rating, battles: et.battles, unsaved: et.unsaved, commits: et.commits } });

  // G1.a: drain the guest to ~0 lamports, then play again on the ER
  try {
    const bal = await client.base.getBalance(p.kp.publicKey);
    await sendBase(client.base, [SystemProgram.transfer({ fromPubkey: p.kp.publicKey, toPubkey: Keypair.generate().publicKey, lamports: bal - 5000 })], [p.kp]);
    const left = await client.base.getBalance(p.kp.publicKey);
    const g = await playPracticeToEnd(client, p.signer, 2, 3, 0);
    log("G1a_unfunded_guest", { pass: g.arena.phase === 5, balanceLamports: left, turns: g.turns.length });
  } catch (e: any) { log("G1a_unfunded_guest", { pass: false, err: String(e.message).slice(0, 300) }); }
  writeFileSync(resolve(__dirname, "../docs/e2e-practice.json"), JSON.stringify(out, null, 2));
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
