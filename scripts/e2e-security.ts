/** Devnet security suite: attackers must not be able to touch someone else's arena/trainer or forge VRF callbacks. */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { AnchorProvider, Program, Wallet } from "@coral-xyz/anchor";
import { Keypair } from "@solana/web3.js";
import { ER_VRF_QUEUE, FEEDS, arenaPda, trainerPda, PROGRAM_ID } from "@pokestonksss/sdk";
import { loadGameIdl } from "./lib/game";
import { makeClient, newPlayer } from "./lib/play";
import { sendEr } from "./lib/chain";

const out: Record<string, string> = {};
let failed = false;
async function attack(label: string, fn: () => Promise<unknown>) {
  try { await fn(); out[label] = "UNEXPECTEDLY SUCCEEDED"; failed = true; console.log("✗", label, "SUCCEEDED (bad)"); }
  catch (e: any) { out[label] = "rejected: " + String(e.message).slice(0, 90); console.log("✓", label, "→ rejected"); }
}

(async () => {
  const client = makeClient();
  const [victim, attacker] = await Promise.all([newPlayer(client, "victim"), newPlayer(client, "attacker")]);
  await client.startPractice(victim.signer, 0, 1, 1);
  const idl: any = loadGameIdl();
  const prog: any = new Program(idl, new AnchorProvider(client.base, new Wallet(attacker.kp), {}));
  const V = victim.kp.publicKey, A = attacker.kp.publicKey;
  const send = async (ix: any) => sendEr(client.er, [ix], [attacker.kp]);

  await attack("attacker locks a pick in the victim's arena", async () =>
    send(await prog.methods.lockPick(1).accounts({ arena: arenaPda(V), signer: A, oracleQueue: ER_VRF_QUEUE }).instruction()));
  await attack("attacker starts a practice battle on the victim's arena", async () =>
    send(await prog.methods.startPractice(0, 1, 1).accounts({ arena: arenaPda(V), trainer: trainerPda(A), signer: A, feedA: FEEDS[0], feedB: FEEDS[1] }).instruction()));
  await attack("attacker commits the victim's trainer", async () =>
    send(await prog.methods.commitTrainer().accounts({ trainer: trainerPda(V), signer: A }).instruction()));
  await attack("attacker resets the victim's live arena", async () =>
    send(await prog.methods.resetArena().accounts({ arena: arenaPda(V), signer: A }).instruction()));
  await attack("forged VRF callback (fake identity signer)", async () =>
    send(await prog.methods.callbackTurn(Array(32).fill(7), 0).accounts({ vrfProgramIdentity: A, arena: arenaPda(V), hostTrainer: trainerPda(V) }).remainingAccounts([
      { pubkey: FEEDS[0], isSigner: false, isWritable: false }, { pubkey: FEEDS[1], isSigner: false, isWritable: false }]).instruction()));
  await attack("attacker forfeits a duel they are not in (practice arena)", async () =>
    send(await prog.methods.forfeit().accounts({ arena: arenaPda(V), hostTrainer: trainerPda(V), guestTrainer: trainerPda(A), signer: A }).instruction()));
  await attack("start_practice with an out-of-range species", async () =>
    sendEr(client.er, [await prog.methods.startPractice(9, 1, 1).accounts({ arena: arenaPda(A), trainer: trainerPda(A), signer: A, feedA: FEEDS[0], feedB: FEEDS[1] }).instruction()], [attacker.kp]));
  // abandoned practice can be restarted immediately (no stuck state)
  try { await client.startPractice(victim.signer, 2, 3, 0); console.log("✓ abandoned practice battle restarts immediately"); out["restart"] = "ok"; }
  catch (e: any) { console.log("✗ restart failed", e.message); out["restart"] = "FAILED"; failed = true; }
  void PROGRAM_ID; void Keypair;
  writeFileSync(resolve(__dirname, "../docs/e2e-security.json"), JSON.stringify(out, null, 2));
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
