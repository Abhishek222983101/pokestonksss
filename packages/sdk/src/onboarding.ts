import { PublicKey } from "@solana/web3.js";
import type { GameClient } from "./client";
import { arenaPda, trainerPda } from "./pda";
import { PROGRAM_ID } from "./config";
import type { TxSigner } from "./tx";
import { sleep } from "./tx";

export type OnboardStep = "funding" | "creating" | "delegating" | "cloning" | "ready";
export interface OnboardEvent { step: OnboardStep; detail?: string; link?: string; ms?: number }

export interface OnboardDeps {
  client: GameClient;
  signer: TxSigner;
  /** asks the faucet for devnet SOL (must resolve once the transfer is confirmed) */
  drip: (pubkey: string) => Promise<void>;
  onEvent?: (e: OnboardEvent) => void;
}

const DELEGATION_PROGRAM = new PublicKey("DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh");

/**
 * Idempotent + resumable: inspects chain state and only does the missing steps.
 * Fresh guest ≈ 3–4 s: fund → (create+delegate in one tx) → ER clone.
 */
export async function ensureReady({ client, signer, drip, onEvent = () => {} }: OnboardDeps): Promise<void> {
  const owner = signer.publicKey;
  const T = trainerPda(owner, client.cfg.programId), A = arenaPda(owner, client.cfg.programId);
  const t0 = performance.now();

  // already live on the ER?
  const [erT, erA] = await Promise.all([client.er.getAccountInfo(T), client.er.getAccountInfo(A)]);
  if (erT && erA) { onEvent({ step: "ready", ms: 0 }); return; }

  const bal = await client.base.getBalance(owner);
  const baseT = await client.base.getAccountInfo(T);
  const needsCreate = !baseT;
  if (needsCreate && bal < client.cfg.minBalance) {
    onEvent({ step: "funding" });
    await drip(owner.toBase58());
    for (let i = 0; i < 40 && (await client.base.getBalance(owner)) < client.cfg.minBalance; i++) await sleep(250);
  }
  if (needsCreate) {
    onEvent({ step: "creating" });
    const rs = await client.onboardAndDelegate(signer);
    onEvent({ step: "delegating", link: rs[rs.length - 1].link, ms: rs[rs.length - 1].ms });
  } else if (baseT && !baseT.owner.equals(DELEGATION_PROGRAM)) {
    onEvent({ step: "delegating" });
    const r = await client.delegate(signer);
    onEvent({ step: "delegating", link: r.link, ms: r.ms });
  }
  onEvent({ step: "cloning" });
  await client.waitCloned(owner);
  onEvent({ step: "ready", ms: Math.round(performance.now() - t0) });
  void PROGRAM_ID;
}
