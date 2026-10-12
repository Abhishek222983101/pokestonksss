/** Devnet e2e for season 2: session keys, levels/xp via the judge Dummy, badge tokens, crank-settled duel. pnpm e2e:v2 */
import { Keypair, PublicKey, Transaction } from "@solana/web3.js";
import { GameClient, ER_VRF_QUEUE, PHASE, ataOf, badgeMintPda, badgesEarned, keypairSigner, levelForXp, sessionSigner, sessionTokenPda, arenaPda, trainerPda } from "@pokestonksss/sdk";
import { dripper, makeClient, sleep, waitArena } from "./lib/play";

let failed = false;
const ok = (label: string, pass: boolean, detail = "") => { console.log(`${pass ? "✓" : "✗"} ${label} ${detail}`); if (!pass) failed = true; };
async function expectFail(label: string, fn: () => Promise<unknown>) {
  try { await fn(); ok(label, false, "unexpectedly succeeded"); } catch (e: any) { ok(label, true, "rejected: " + String(e.message).slice(0, 70)); }
}

async function sendBaseMulti(client: GameClient, ixs: any[], signers: Keypair[]) {
  const { blockhash, lastValidBlockHeight } = await client.base.getLatestBlockhash("confirmed");
  const tx = new Transaction({ feePayer: signers[0].publicKey, blockhash, lastValidBlockHeight }).add(...ixs);
  tx.sign(...signers);
  const sig = await client.base.sendRawTransaction(tx.serialize());
  await client.base.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
  return sig;
}

async function winDummy(client: GameClient, ss: ReturnType<typeof sessionSigner>, owner: PublicKey, species: number) {
  await client.startPractice(ss, species, 1, 4);
  let a = await client.getArena(owner);
  for (let g = 0; g < 30 && a && a.phase !== PHASE.FINISHED; g++) {
    const turn = a.match.turn;
    await client.lockPick(ss, 0);
    a = await waitArena(client, owner, (x) => x.match.turn > turn || x.phase === PHASE.FINISHED, 30_000, "VRF callback");
  }
  return a!;
}

(async () => {
  const client = makeClient();
  const W = Keypair.generate(), S = Keypair.generate();
  await dripper(client)(W.publicKey.toBase58());
  for (let i = 0; i < 40 && (await client.base.getBalance(W.publicKey)) < 20_000_000; i++) await sleep(250);

  // 1. one wallet transaction: create trainer + delegate + session token (wallet and session key both sign)
  const t0 = performance.now();
  const [a, b] = await Promise.all([client.onboardIx(W.publicKey, 7, 2), client.delegateIx(W.publicKey)]);
  const c = client.createSessionIx(W.publicKey, S.publicKey, Math.floor(Date.now() / 1000) + 3600);
  const sig = await sendBaseMulti(client, [a, b, c], [W, S]);
  ok("onboard + delegate + session token in ONE base tx", true, `${Math.round(performance.now() - t0)} ms ${sig.slice(0, 12)}…`);
  ok("session token exists on chain", await client.sessionActive(S.publicKey, W.publicKey));
  await client.waitCloned(W.publicKey);
  const tok = sessionTokenPda(S.publicKey, W.publicKey, client.cfg.programId);
  const ss = sessionSigner(S, W.publicKey, tok);

  // 2. the unfunded session key plays for the wallet: no wallet signature on the rollup
  ok("session key holds no SOL", (await client.base.getBalance(S.publicKey)) === 0);
  const t = await client.getTrainer(W.publicKey);
  ok("trainer owner is the wallet, avatar saved", t?.owner === W.publicKey.toBase58() && t.avatar === 2, JSON.stringify({ avatar: t?.avatar }));
  await expectFail("a stranger's session key cannot act for the wallet", async () => {
    const X = Keypair.generate();
    await client.startPractice({ ...keypairSigner(X), authority: W.publicKey, sessionToken: tok }, 0, 1, 4);
  });

  // 3. levels: four Dummy wins = 120 xp = level 3 (first evolution), the fifth pays nothing
  let last;
  for (let i = 0; i < 4; i++) {
    last = await winDummy(client, ss, W.publicKey, 0);
    ok(`dummy battle ${i + 1} won by the session key`, last.winner === 0, `turns ${last.log.length}`);
  }
  let tr = await client.getTrainer(W.publicKey);
  ok("xp 120 => level 3", tr!.xp[0] === 120 && levelForXp(tr!.xp[0]) === 3, `xp ${tr!.xp[0]}`);
  const lvl = last!.match.sides[0].level;
  ok("level shows up in the arena state", lvl === 2 || lvl === 3, `level ${lvl}`);
  await winDummy(client, ss, W.publicKey, 0);
  tr = await client.getTrainer(W.publicKey);
  ok("no dummy farming past the first evolution", tr!.xp[0] === 120, `xp ${tr!.xp[0]}`);

  // 4. save to Solana, then mint badges (permissionless relayer = anyone; here the wallet itself)
  const cm = await client.commitTrainer(ss);
  console.log("  commit", cm.link);
  await sleep(5000);
  const base = await client.getTrainer(W.publicKey, "base");
  ok("progress committed to base", !!base && base.wins >= 5 && base.xp[0] === 120, `wins ${base?.wins}`);
  const earned = badgesEarned(base!);
  ok("client badge rules say First Blood, Regular, Evolved", earned[0] && earned[1] && earned[5] && !earned[4]);
  const payer = keypairSigner(W);
  const m0 = await client.mintBadge(payer, W.publicKey, 0);
  console.log("  badge 0", m0.link);
  const bal = await client.base.getTokenAccountBalance(ataOf(W.publicKey, badgeMintPda(0, client.cfg.programId)));
  ok("badge token is in the wallet", bal.value.uiAmount === 1, `balance ${bal.value.uiAmount}`);
  await expectFail("a badge cannot be minted twice", () => client.mintBadge(payer, W.publicKey, 0));
  await expectFail("an unearned badge (Shark) is refused", () => client.mintBadge(payer, W.publicKey, 4));
  const m5 = await client.mintBadge(payer, W.publicKey, 5);
  console.log("  badge 5", m5.link);
  const m9 = await client.mintBadge(payer, W.publicKey, 9);
  console.log("  trophy $BTC (badge 9)", m9.link);
  ok("claimed list (First Blood, Evolved, $BTC trophy)", (await client.claimedBadges(W.publicKey)).join() === "0,5,9");
  await expectFail("a trophy for an asset you never beat ($SUI) is refused", () => client.mintBadge(payer, W.publicKey, 11));

  // 5. crank: a duel abandoned by the guest is settled by the validator's task scheduler
  const H = Keypair.generate(), G = Keypair.generate();
  const hs = keypairSigner(H), gs = keypairSigner(G);
  const { ensureReady } = await import("@pokestonksss/sdk");
  await Promise.all([ensureReady({ client, signer: hs, drip: dripper(client) }), ensureReady({ client, signer: gs, drip: dripper(client) })]);
  const token = GameClient.newToken();
  await client.openDuel(hs, 0, token);
  await client.joinDuel(gs, H.publicKey, 0, 1, token);
  await waitArena(client, H.publicKey, (x) => x.phase === PHASE.PICKING, 15_000, "PICKING");
  const host = H.publicKey;
  const arenaKey = arenaPda(host);
  await client.commitPick(hs, host, GameClient.commitment(0, new Uint8Array(32), arenaKey, 0, H.publicKey));
  const arm = await client.armTimer(hs, host);
  ok("crank armed (ScheduleTask CPI succeeded on the rollup)", true, arm.link);
  const t1 = Date.now();
  let done = false;
  for (let i = 0; i < 40 && !done; i++) {
    await sleep(5000);
    const ar = await client.getArena(host);
    if (ar && ar.phase === PHASE.FINISHED) { done = true; ok("crank settled the idle duel", ar.winner === 0, `winner seat ${ar.winner} after ${Math.round((Date.now() - t1) / 1000)} s`); }
  }
  if (!done) ok("crank settled the idle duel", false, "not settled within 200 s");
  void ER_VRF_QUEUE; void trainerPda;
  console.log(failed ? "\nFAILED" : "\nALL PASSED");
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
