/**
 * Devnet end-to-end: onboard → delegate → practice battle to KO on the ER (VRF per turn, oracle mood) →
 * commit → undrained/unfunded-guest check. Prints every signature + latency table, writes docs/e2e-practice.json.
 *   pnpm --filter scripts e2e:practice     (needs the program deployed: scripts/deploy-devnet.sh pokestonksss)
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { AnchorProvider, Program, Wallet } from "@coral-xyz/anchor";
import { Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram } from "@solana/web3.js";
import { devnet } from "./lib/config";
import { connections, sendBase, sendEr, sleep, waitFor } from "./lib/chain";
import { arenaPda, decodeState, FEEDS, loadGameIdl, PHASE, programIdOf, trainerPda } from "./lib/game";

const region = (process.env.REGION as "as" | "eu" | "us") ?? "as";
const net = devnet(region);
const { base, er } = connections(net);
const idl: any = loadGameIdl();
const programId = programIdOf();
const out: Record<string, unknown> = { region, programId: programId.toBase58(), at: new Date().toISOString(), turns: [] as unknown[] };
const link = (sig: string, onEr = false) => `https://explorer.solana.com/tx/${sig}?cluster=${onEr ? `custom&customUrl=${encodeURIComponent(net.er)}` : "devnet"}`;
const stats = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return { n: s.length, p50: s[Math.floor(s.length / 2)], p95: s[Math.min(s.length - 1, Math.floor(s.length * 0.95))], max: s[s.length - 1] }; };
const log = (k: string, v: unknown) => { out[k] = v; console.log(`[${k}]`, typeof v === "string" ? v : JSON.stringify(v)); };

const progFor = (conn: typeof base, kp: Keypair): any => new Program(idl, new AnchorProvider(conn, new Wallet(kp), { commitment: "confirmed" }));

async function airdrop(pk: PublicKey, sol: number) {
  for (let i = 0; i < 5; i++) {
    try { const sig = await base.requestAirdrop(pk, sol * LAMPORTS_PER_SOL); const bh = await base.getLatestBlockhash(); await base.confirmTransaction({ signature: sig, ...bh }, "confirmed"); return true; }
    catch { await sleep(2500 * (i + 1)); }
  }
  return false;
}

export async function onboard(kp: Keypair) {
  const bp = progFor(base, kp);
  const t0 = performance.now();
  const ix1 = await bp.methods.onboard(Math.floor(Math.random() * 2 ** 31)).accounts({ payer: kp.publicKey } as never).instruction();
  const ix2 = await bp.methods.delegateAll().accounts({ payer: kp.publicKey } as never).remainingAccounts([{ pubkey: net.validator, isSigner: false, isWritable: false }]).instruction();
  let sig: string, mode = "single-tx";
  try { sig = await sendBase(base, [ix1, ix2], [kp]); }
  catch (e: any) { mode = "two-tx"; console.log("single tx failed:", String(e.message).slice(0, 200)); const s1 = await sendBase(base, [ix1], [kp]); sig = await sendBase(base, [ix2], [kp]); log("onboard_first_sig", s1); }
  const t1 = performance.now();
  const T = trainerPda(programId, kp.publicKey), A = arenaPda(programId, kp.publicKey);
  await waitFor(async () => (await er.getAccountInfo(T)) && (await er.getAccountInfo(A)) ? true : null, { timeoutMs: 45_000, pollMs: 100, label: "ER clone" });
  return { sig, mode, baseMs: Math.round(t1 - t0), cloneMs: Math.round(performance.now() - t1), totalMs: Math.round(performance.now() - t0) };
}

export async function playPractice(kp: Keypair, species = 0, opp = 1, tier = 1) {
  const ep = progFor(er, kp);
  const A = arenaPda(programId, kp.publicKey);
  const fetchArena = async () => (await ep.account.arena.fetch(A)) as any;
  const t0 = performance.now();
  const s = await sendEr(er, [await ep.methods.startPractice(species, opp, tier).accounts({ signer: kp.publicKey, feedA: FEEDS[species], feedB: FEEDS[opp] } as never).instruction()], [kp]);
  const startMs = Math.round(performance.now() - t0);
  const turns: any[] = [];
  let arena = await fetchArena();
  for (let guard = 0; guard < 40 && arena.phase !== PHASE.FINISHED; guard++) {
    const turnBefore = decodeState(arena.state).turn;
    const slot = [0, 1, 2, 3][Math.floor(Math.random() * 4)];
    const t = performance.now();
    const r = await sendEr(er, [await ep.methods.lockPick(slot).accounts({ signer: kp.publicKey, oracleQueue: net.erQueue } as never).instruction()], [kp]);
    const tLock = performance.now();
    arena = await waitFor(async () => { const a = await fetchArena(); return !a.vrfPending && a.phase !== PHASE.ROLLING ? a : null; }, { timeoutMs: 30_000, pollMs: 50, label: "VRF callback" });
    const st = decodeState(arena.state);
    turns.push({ turn: turnBefore, pick: slot, lockMs: Math.round(tLock - t), resolveMs: Math.round(performance.now() - tLock), hp: [st.sides[0].hp, st.sides[1].hp], mood: Array.from(Buffer.from(arena.log[arena.logLen - 1]).subarray(12, 14)).map((x) => (x > 127 ? x - 256 : x)), sig: r.sig });
  }
  const st = decodeState(arena.state);
  return { startSig: s.sig, startMs, turns, finished: arena.phase === PHASE.FINISHED, winner: st.winner, snap: arena.snap.map((x: any) => x.toString()) };
}

async function main() {
  const kp = Keypair.generate();
  console.log("program", programId.toBase58(), "guest", kp.publicKey.toBase58());
  if (!(await airdrop(kp.publicKey, 1))) { log("fund", "AIRDROP FAILED — send ~0.05 SOL to " + kp.publicKey.toBase58() + " then re-run with GUEST_KEY unsupported; use the faucet route"); process.exit(2); }
  log("onboard", await onboard(kp));
  const r = await playPractice(kp);
  out.practice = { ...r, turns: undefined }; out.turns = r.turns;
  const lock = r.turns.map((t) => t.lockMs), res = r.turns.map((t) => t.resolveMs);
  log("start_practice_ms", r.startMs); log("lock_ms", stats(lock)); log("lock_to_resolved_ms", stats(res));
  log("battle", { turns: r.turns.length, finished: r.finished, winner: r.winner, snap: r.snap, startLink: link(r.startSig, true) });
  console.log(r.turns.map((t) => `T${t.turn} pick${t.pick} hp${t.hp} mood${t.mood} ${t.lockMs}+${t.resolveMs}ms`).join("\n"));

  // commit trainer (Saved to Solana)
  const ep = progFor(er, kp);
  const c = await sendEr(er, [await ep.methods.commitTrainer().accounts({ signer: kp.publicKey } as never).instruction()], [kp]);
  await sleep(4000);
  const T = trainerPda(programId, kp.publicKey);
  const bt = await base.getAccountInfo(T);
  const dec = bt ? new Program(idl, new AnchorProvider(base, new Wallet(kp), {})).coder.accounts.decode("trainer", bt.data) : null;
  log("commit", { sig: c.sig, link: link(c.sig, true), baseTrainer: dec && { rating: dec.rating, wins: dec.wins, losses: dec.losses, battles: dec.battles } });

  // G1.a: drain the guest to 0 lamports and play again on the ER
  try {
    const bal = await base.getBalance(kp.publicKey);
    await sendBase(base, [SystemProgram.transfer({ fromPubkey: kp.publicKey, toPubkey: Keypair.generate().publicKey, lamports: bal - 5000 })], [kp]);
    const left = await base.getBalance(kp.publicKey);
    const g = await playPractice(kp, 2, 3, 0);
    log("G1a_unfunded_guest", { pass: g.finished, balanceLamports: left, turns: g.turns.length });
  } catch (e: any) { log("G1a_unfunded_guest", { pass: false, err: String(e.message).slice(0, 300) }); }
  writeFileSync(resolve(__dirname, "../docs/e2e-practice.json"), JSON.stringify(out, null, 2));
  console.log("WROTE docs/e2e-practice.json");
  process.exit(0);
}
if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
