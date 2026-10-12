/** Headless judge self-test: the same checklist the /judge page shows. pnpm --filter scripts judge */
import { PublicKey } from "@solana/web3.js";
import { FEEDS, PROGRAM_ID, accountLink, arenaPda, tierName, trainerPda } from "@pokestonksss/sdk";
import { makeClient, newPlayer, playPracticeToEnd, stats } from "./lib/play";

(async () => {
  const client = makeClient();
  const rows: [string, boolean, string][] = [];
  const row = (n: string, ok: boolean, d: string) => { rows.push([n, ok, d]); console.log(`${ok ? "✓" : "✗"} ${n} — ${d}`); };
  const events: string[] = [];
  const p = await newPlayer(client, "judge", (e) => events.push(e.step + (e.link ? ` ${e.link}` : "")));
  row("Onboarding (create + delegate + ER clone)", true, `${p.onboardMs} ms`);
  const base = await client.base.getAccountInfo(trainerPda(p.kp.publicKey));
  row("Trainer delegated on Solana (owner = Delegation Program)", !!base && base.owner.toBase58().startsWith("DELeGG"), accountLink(trainerPda(p.kp.publicKey).toBase58(), "base", client.cfg));
  const r = await playPracticeToEnd(client, p.signer, 0, 1, 1);
  row("start_practice on the ER", true, `${r.start.ms} ms  ${r.start.link}`);
  row("Per-turn VRF rolls resolved", r.turns.length > 0, `${r.turns.length} turns; lock→resolved ${JSON.stringify(stats(r.turns.map((t) => t.resolveMs)))}`);
  r.turns.slice(0, 3).forEach((t, i) => row(`  lock_pick turn ${i}`, true, t.link));
  row("Battle finished", r.arena.phase === 5, `winner side ${r.arena.winner}`);
  row("Oracle weigh-in snapshot", r.arena.snap[0] > 0n || r.arena.snap[1] > 0n, `snap ${r.arena.snap.map(String).join(" / ")} (0 = oracle idle)`);
  const c = await client.commitTrainer(p.signer);
  row("Saved to Solana (commit)", true, c.link);
  const t = await client.getTrainer(p.kp.publicKey);
  row("Rewards landed on Trainer", !!t && t.battles >= 1, `rating ${t?.rating} (${tierName(t?.rating ?? 0)}), W${t?.wins}/L${t?.losses}`);
  row("Program", true, accountLink(PROGRAM_ID.toBase58(), "base", client.cfg));
  row("Arena PDA", true, accountLink(arenaPda(p.kp.publicKey).toBase58(), "er", client.cfg));
  row("Oracle feeds", true, FEEDS.map((f: PublicKey) => f.toBase58().slice(0, 6)).join(" "));
  process.exit(rows.every(([, ok]) => ok) ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
