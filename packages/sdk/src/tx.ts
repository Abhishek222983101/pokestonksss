import { Connection, PublicKey, Transaction, TransactionInstruction, Keypair } from "@solana/web3.js";
import type { Latency } from "./latency";

export interface TxSigner { publicKey: PublicKey; sign(tx: Transaction): Promise<Transaction> }
export const keypairSigner = (kp: Keypair): TxSigner => ({ publicKey: kp.publicKey, sign: async (tx) => { tx.partialSign(kp); return tx; } });

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface Sent { sig: string; ms: number }

async function confirmPoll(conn: Connection, sig: string, timeoutMs: number, pollMs = 25) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const { value } = await conn.getSignatureStatuses([sig]);
    const st = value[0];
    if (st) {
      if (st.err) throw new Error(`transaction failed: ${JSON.stringify(st.err)}`);
      if (st.confirmationStatus === "confirmed" || st.confirmationStatus === "finalized") return;
    }
    if (Date.now() > deadline) throw new Error("transaction not confirmed in time");
    await sleep(pollMs);
  }
}

/** ER send: ER blockhash, skipPreflight (what MagicBlock examples do), fast status polling, 1 retry on stale blockhash. */
export async function sendEr(er: Connection, ixs: TransactionInstruction[], signer: TxSigner, latency?: Latency): Promise<Sent> {
  const t0 = performance.now();
  for (let attempt = 0; ; attempt++) {
    try {
      const { blockhash, lastValidBlockHeight } = await er.getLatestBlockhash("confirmed");
      const tx = new Transaction({ feePayer: signer.publicKey, blockhash, lastValidBlockHeight }).add(...ixs);
      const signed = await signer.sign(tx);
      const sig = await er.sendRawTransaction(signed.serialize(), { skipPreflight: true });
      await confirmPoll(er, sig, 15_000);
      const ms = Math.round(performance.now() - t0);
      latency?.add(ms);
      return { sig, ms };
    } catch (e) {
      const m = String((e as Error).message);
      if (attempt < 1 && /blockhash/i.test(m)) continue;
      throw e;
    }
  }
}

export async function sendBase(base: Connection, ixs: TransactionInstruction[], signer: TxSigner): Promise<Sent> {
  const t0 = performance.now();
  const { blockhash, lastValidBlockHeight } = await base.getLatestBlockhash("confirmed");
  const tx = new Transaction({ feePayer: signer.publicKey, blockhash, lastValidBlockHeight }).add(...ixs);
  const signed = await signer.sign(tx);
  const sig = await base.sendRawTransaction(signed.serialize(), { skipPreflight: false });
  await base.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
  return { sig, ms: Math.round(performance.now() - t0) };
}

export async function waitFor<T>(fn: () => Promise<T | null | undefined | false>, { timeoutMs = 30_000, pollMs = 100, label = "condition" } = {}): Promise<T> {
  const t0 = Date.now();
  for (;;) {
    const v = await fn().catch(() => null);
    if (v) return v;
    if (Date.now() - t0 > timeoutMs) throw new Error(`timeout waiting for ${label}`);
    await sleep(pollMs);
  }
}
