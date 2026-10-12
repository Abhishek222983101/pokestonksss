/** Devnet duel e2e: two guests, invite token, sealed commit-reveal turns, negative tests. pnpm --filter scripts e2e:duel */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { GameClient, arenaPda, PHASE } from "@pokestonksss/sdk";
import { makeClient, newPlayer, sleep, stats, waitArena } from "./lib/play";

const out: Record<string, unknown> = { at: new Date().toISOString() };
const log = (k: string, v: unknown) => { out[k] = v; console.log(`[${k}]`, typeof v === "string" ? v : JSON.stringify(v)); };
async function expectFail(label: string, fn: () => Promise<unknown>) {
  try { await fn(); log("NEG_" + label, "UNEXPECTEDLY SUCCEEDED"); out["failed"] = true; }
  catch (e: any) { log("NEG_" + label, "rejected ✓ " + String(e.message).slice(0, 80)); }
}

async function main() {
  const client = makeClient();
  const [H, G, S] = await Promise.all([newPlayer(client, "host"), newPlayer(client, "guest"), newPlayer(client, "spectator")]);
  log("onboard_ms", { host: H.onboardMs, guest: G.onboardMs });
  const token = GameClient.newToken();
  const hs = 0, gs = 1;

  const o = await client.openDuel(H.signer, hs, token);
  log("open_duel", { ms: o.ms, link: o.link });
  await expectFail("wrong_token", () => client.joinDuel(G.signer, H.kp.publicKey, hs, gs, GameClient.newToken()));
  await expectFail("self_join", () => client.joinDuel(H.signer, H.kp.publicKey, hs, hs, token));
  const j = await client.joinDuel(G.signer, H.kp.publicKey, hs, gs, token);
  log("join_duel", { ms: j.ms, link: j.link });
  await expectFail("double_join", () => client.joinDuel(S.signer, H.kp.publicKey, hs, 2, token));
  await expectFail("claim_timeout_early", () => client.claimTimeout(S.signer, H.kp.publicKey, G.kp.publicKey));

  const host = H.kp.publicKey;
  const arenaKey = arenaPda(host);
  const lat: number[] = [];
  let a = await waitArena(client, host, (x) => x.phase === PHASE.PICKING, 15_000, "PICKING");
  for (let g = 0; g < 40 && a.phase !== PHASE.FINISHED; g++) {
    const turn = a.match.turn;
    const sH = Math.floor(Math.random() * 4), sG = Math.floor(Math.random() * 4);
    const saltH = crypto.getRandomValues(new Uint8Array(32)), saltG = crypto.getRandomValues(new Uint8Array(32));
    const t = performance.now();
    await Promise.all([
      client.commitPick(H.signer, host, GameClient.commitment(sH, saltH, arenaKey, turn, H.kp.publicKey)),
      client.commitPick(G.signer, host, GameClient.commitment(sG, saltG, arenaKey, turn, G.kp.publicKey)),
    ]);
    await waitArena(client, host, (x) => x.phase === PHASE.REVEALING, 15_000, "REVEALING");
    if (g === 0) {
      await expectFail("reveal_wrong_salt", () => client.revealPick(H.signer, host, sH, new Uint8Array(32)));
      await expectFail("spectator_commit", () => client.commitPick(S.signer, host, Array(32).fill(1)));
    }
    await client.revealPick(H.signer, host, sH, saltH);
    await client.revealPick(G.signer, host, sG, saltG);
    a = await waitArena(client, host, (x) => x.match.turn > turn || x.phase === PHASE.FINISHED, 30_000, "VRF callback");
    lat.push(Math.round(performance.now() - t));
    console.log(`turn ${turn}: picks ${sH}/${sG} hp ${a.match.sides[0].hp}/${a.match.sides[1].hp} ${lat[lat.length - 1]} ms`);
  }
  log("turn_ms", stats(lat));
  log("result", { finished: a.phase === PHASE.FINISHED, winner: a.winner, turns: a.log.length });
  const [th, tg] = await Promise.all([client.getTrainer(host), client.getTrainer(G.kp.publicKey)]);
  log("trainers", { host: th && { rating: th.rating, w: th.wins, l: th.losses }, guest: tg && { rating: tg.rating, w: tg.wins, l: tg.losses } });
  if (th && tg && th.rating + tg.rating !== 2000) { log("FAIL", "ratings not zero-sum"); out["failed"] = true; }
  await sleep(10);
  writeFileSync(resolve(__dirname, "../docs/e2e-duel.json"), JSON.stringify(out, null, 2));
  process.exit(out["failed"] ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
