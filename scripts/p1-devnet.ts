/**
 * P1 — devnet feasibility spike. Proves every MagicBlock behaviour the game depends on.
 *   pnpm --filter scripts p1          (needs the spike program deployed: scripts/deploy-devnet.sh er-vrf)
 * Writes docs/p1-results.json. Never reads private keys except throwaway keypairs generated here.
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { devnet, PROGRAMS } from "./lib/config";
import { battlePda, connections, loadIdl, programFor, sendBase, sendEr, sleep, waitFor } from "./lib/chain";

const region = (process.env.REGION as "as" | "eu" | "us") ?? "as";
const net = devnet(region);
const { base, er } = connections(net);
const idl = loadIdl();
const programId = new PublicKey(idl.address);
const results: Record<string, unknown> = { region, programId: programId.toBase58(), at: new Date().toISOString() };
const stats = (a: number[]) => {
  const s = [...a].sort((x, y) => x - y);
  return { n: s.length, p50: s[Math.floor(s.length * 0.5)], p95: s[Math.min(s.length - 1, Math.floor(s.length * 0.95))], min: s[0], max: s[s.length - 1] };
};
const ok = (k: string, v: unknown) => { results[k] = v; console.log(`[${k}]`, typeof v === "string" ? v : JSON.stringify(v)); };
const explorer = (sig: string, onEr = false) =>
  `https://explorer.solana.com/tx/${sig}?cluster=${onEr ? `custom&customUrl=${encodeURIComponent(net.er)}` : "devnet"}`;

async function airdrop(pk: PublicKey, sol: number) {
  for (let i = 0; i < 4; i++) {
    try {
      const sig = await base.requestAirdrop(pk, sol * LAMPORTS_PER_SOL);
      const bh = await base.getLatestBlockhash();
      await base.confirmTransaction({ signature: sig, ...bh }, "confirmed");
      return true;
    } catch (e) { await sleep(2000 * (i + 1)); }
  }
  return false;
}

async function main() {
  const A = Keypair.generate(); // funded player
  const B = Keypair.generate(); // UNFUNDED player (test G1.a)
  const prog = programFor(base, A);
  const pda = battlePda(programId, A.publicKey);
  console.log("program", programId.toBase58(), "A", A.publicKey.toBase58(), "region", region);

  // --- fund A (public faucet; fall back to env FUNDED_BY handled by user-run script if this fails)
  const funded = await airdrop(A.publicKey, 2);
  ok("fund", funded ? "airdrop ok (2 SOL)" : "AIRDROP FAILED — fund A manually: " + A.publicKey.toBase58());
  if (!funded) { writeFileSync(resolve(__dirname, "../docs/p1-results.json"), JSON.stringify(results, null, 2)); process.exit(2); }

  // --- P1.3 init + delegate, time until ER sees the account
  const t0 = performance.now();
  const sigInit = await sendBase(base, [await prog.methods.createBattle(B.publicKey).accounts({ creator: A.publicKey } as never).instruction()], [A]);
  const tInit = performance.now();
  const sigDel = await sendBase(base, [await prog.methods.delegateBattle().accounts({ payer: A.publicKey, pda } as never).remainingAccounts([{ pubkey: net.validator, isSigner: false, isWritable: false }]).instruction()], [A]);
  const tDel = performance.now();
  await waitFor(async () => (await er.getAccountInfo(pda)) ? true : null, { timeoutMs: 40_000, pollMs: 100, label: "ER clone" });
  const tClone = performance.now();
  ok("P1.3_onboard_ms", { init: Math.round(tInit - t0), delegate: Math.round(tDel - tInit), erVisible: Math.round(tClone - tDel), total: Math.round(tClone - t0) });
  ok("P1.3_links", { init: explorer(sigInit), delegate: explorer(sigDel) });

  // --- P1.4 ER txs from A (funded) + G1.a unfunded B
  const lat: number[] = [];
  let lastSig = "";
  const erProg = programFor(er, A);
  const play = async (signer: Keypair, mv: number) => {
    const ix = await erProg.methods.playMove(mv).accounts({ battle: pda, sessionToken: null, signer: signer.publicKey } as never).instruction();
    return sendEr(er, [ix], [signer], { pollMs: 25 });
  };
  try {
    const r = await play(A, 1); lat.push(r.sendMs + r.confirmMs); lastSig = r.sig;
    ok("P1.4_first_er_tx", { ...r, link: explorer(r.sig, true) });
  } catch (e: any) { ok("P1.4_first_er_tx", "FAILED " + e.message); }
  // after A moved, mover = B (0 lamports)
  let unfundedOk = false, unfundedErr = "";
  try { const r = await play(B, 2); unfundedOk = true; lat.push(r.sendMs + r.confirmMs); ok("G1a_unfunded_guest_er_tx", { pass: true, ...r }); }
  catch (e: any) { unfundedErr = String(e.message).slice(0, 300); ok("G1a_unfunded_guest_er_tx", { pass: false, err: unfundedErr }); }
  // more txs for latency stats (alternate mover)
  let mover: Keypair = unfundedOk ? A : B;
  for (let i = 0; i < 12; i++) {
    const s = unfundedOk ? (i % 2 === 0 ? A : B) : A; // if B can't pay, only A moves when it's A's turn
    try { const r = await play(s, (i % 4) + 1); lat.push(r.sendMs + r.confirmMs); } catch { break; }
  }
  ok("P1.4_er_tx_latency_ms", stats(lat));

  // --- P1.5 delegated VRF on the ER
  const bState = async () => (await programFor(er, A).account.battle.fetch(pda)) as any;
  const vrfLat: number[] = [];
  for (let i = 0; i < 5; i++) {
    const b = await bState();
    const moverKey = (b.turn % 2 === 0 ? b.players[0] : b.players[1]) as PublicKey;
    const signer = moverKey.equals(A.publicKey) ? A : B;
    const t = performance.now();
    try {
      const ix = await erProg.methods.requestRoll(i + 1).accounts({ battle: pda, sessionToken: null, signer: signer.publicKey, oracleQueue: net.erQueue } as never).instruction();
      await sendEr(er, [ix], [signer]);
      await waitFor(async () => { const x = await bState(); return !x.rollPending ? x : null; }, { timeoutMs: 20_000, pollMs: 50, label: "VRF callback" });
      vrfLat.push(Math.round(performance.now() - t));
    } catch (e: any) { ok("P1.5_vrf_error", String(e.message).slice(0, 300)); break; }
    // advance the turn so the mover alternates and roll_pending resets
    try { const s2 = signer; const ix2 = await erProg.methods.playMove(1).accounts({ battle: pda, sessionToken: null, signer: s2.publicKey } as never).instruction(); await sendEr(er, [ix2], [s2]); } catch {}
  }
  ok("P1.5_vrf_request_to_callback_ms", vrfLat.length ? stats(vrfLat) : "NO CALLBACKS");

  // --- P1.6 crank: play_move armed a 30 s timer; wait and see turn advance with timeouts++
  const before = await bState();
  const tc0 = Date.now();
  const fired = await waitFor(async () => { const x = await bState(); return x.timeouts > before.timeouts ? x : null; }, { timeoutMs: 45_000, pollMs: 500, label: "crank timeout" }).catch(() => null);
  ok("P1.6_crank", fired ? { pass: true, firedAfterMs: Date.now() - tc0, timeouts: fired.timeouts } : { pass: false, note: "timeout_turn did not fire within 45 s (use fallback: permissionless claim_timeout)" });

  // --- P1.7 commit then end (commit_and_undelegate)
  try {
    const cur = await bState();
    const moverKey = (cur.turn % 2 === 0 ? cur.players[0] : cur.players[1]) as PublicKey;
    const signer = moverKey.equals(A.publicKey) ? A : B;
    const cix = await erProg.methods.commitBattle().accounts({ battle: pda, sessionToken: null, signer: signer.publicKey } as never).instruction();
    const c = await sendEr(er, [cix], [signer]);
    await sleep(3000);
    const baseAcc = await base.getAccountInfo(pda);
    ok("P1.7_commit", { sig: c.sig, link: explorer(c.sig, true), baseOwner: baseAcc?.owner.toBase58(), baseIsDelegated: baseAcc?.owner.equals(PROGRAMS.delegation) });
    const eix = await erProg.methods.endBattle().accounts({ battle: pda, sessionToken: null, signer: signer.publicKey } as never).instruction();
    const e1 = await sendEr(er, [eix], [signer]);
    const back = await waitFor(async () => { const a = await base.getAccountInfo(pda); return a && a.owner.equals(programId) ? a : null; }, { timeoutMs: 40_000, pollMs: 500, label: "undelegate" }).catch(() => null);
    ok("P1.7_undelegate", { sig: e1.sig, backOnBase: !!back });
  } catch (e: any) { ok("P1.7_commit_error", String(e.message).slice(0, 400)); }

  // --- P1.8 oracle (SOL id 6) on the ER
  const feed = new PublicKey("ENYwebBThHzmzwPLAQvCucUTsjyfBSZdD9ViXksS4jPu");
  const info = await er.getAccountInfo(feed);
  if (info) {
    const d = info.data; const price = d.readBigInt64LE(73); const expo = d.readInt32LE(89); const pt = Number(d.readBigInt64LE(93));
    ok("P1.8_oracle_SOL", { len: d.length, price: price.toString(), expo, usd: Number(price) * Math.pow(10, -expo), ageSec: Math.round(Date.now() / 1000 - pt) });
  } else ok("P1.8_oracle_SOL", "feed account not found on ER");
  writeFileSync(resolve(__dirname, "../docs/p1-results.json"), JSON.stringify(results, null, 2));
  console.log("\nWROTE docs/p1-results.json");
  process.exit(0);
}
main().catch((e) => { console.error(e); writeFileSync(resolve(__dirname, "../docs/p1-results.json"), JSON.stringify({ ...results, fatal: String(e) }, null, 2)); process.exit(1); });
