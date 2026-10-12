import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as anchor from "@coral-xyz/anchor";
import { AnchorProvider, BN, Program, Wallet } from "@coral-xyz/anchor";
import {
  Commitment,
  Connection,
  Keypair,
  PublicKey,
  Signer,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import { SessionTokenManager } from "@magicblock-labs/gum-sdk";
import { NetConfig, PROGRAMS } from "./config";
type ErVrf = any;

const here = __dirname;

// ---------------------------------------------------------------------------------------------
// IDL / program
// ---------------------------------------------------------------------------------------------
export function loadIdl(): ErVrf {
  // `anchor build` (CLI 0.32.1) writes target/idl/er_vrf.json for the Anchor 1.x program just fine.
  return JSON.parse(readFileSync(resolve(here, "../../target/idl/er_vrf.json"), "utf8")) as ErVrf;
}

export function loadKeypair(path: string): Keypair {
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, "utf8"))));
}

export const BATTLE_SEED = Buffer.from("battle");

export function battlePda(programId: PublicKey, creator: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([BATTLE_SEED, creator.toBuffer()], programId)[0];
}

/** `["session_token_v2", target_program, session_signer, authority]` under the session-keys program */
export function sessionTokenV2Pda(
  targetProgram: PublicKey,
  sessionSigner: PublicKey,
  authority: PublicKey,
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("session_token_v2"), targetProgram.toBuffer(), sessionSigner.toBuffer(), authority.toBuffer()],
    PROGRAMS.sessionKeys,
  )[0];
}

/** crank signer PDA the validator's task scheduler signs with: `["crank-executor", task authority]` */
export function crankSignerPda(taskAuthority: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("crank-executor"), taskAuthority.toBuffer()], PROGRAMS.crank)[0];
}

// ---------------------------------------------------------------------------------------------
// Connections: ALWAYS two (or three) separate ones. Never reuse a blockhash across them.
// ---------------------------------------------------------------------------------------------
export interface Conns {
  base: Connection;
  er: Connection;
}

export function connections(net: NetConfig, commitment: Commitment = "confirmed"): Conns {
  return {
    base: new Connection(net.base, { commitment, wsEndpoint: net.baseWs }),
    er: new Connection(net.er, { commitment, wsEndpoint: net.erWs }),
  };
}

export function programFor(conn: Connection, payer: Keypair): Program<ErVrf> {
  const provider = new AnchorProvider(conn, new Wallet(payer), { commitment: "confirmed", skipPreflight: true });
  return new Program<ErVrf>(loadIdl(), provider);
}

// ---------------------------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------------------------
export async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

/**
 * Send a tx to the ER and confirm it by polling getSignatureStatuses every `pollMs`.
 *  - blockhash MUST come from the ER connection (a base blockhash is rejected: "Blockhash not found")
 *  - skipPreflight: true (what every MagicBlock example does for ER txs)
 *  - the ER has no "slots to wait for": status flips to `confirmed` within a slot or two
 */
export async function sendEr(
  er: Connection,
  ixs: TransactionInstruction[],
  signers: Signer[],
  opts: { pollMs?: number; timeoutMs?: number } = {},
): Promise<{ sig: string; sendMs: number; confirmMs: number }> {
  const t0 = performance.now();
  const { blockhash, lastValidBlockHeight } = await er.getLatestBlockhash("confirmed");
  const tx = new Transaction({ feePayer: signers[0].publicKey, blockhash, lastValidBlockHeight }).add(...ixs);
  tx.sign(...signers);
  const sig = await er.sendRawTransaction(tx.serialize(), { skipPreflight: true });
  const t1 = performance.now();
  await confirmFast(er, sig, opts);
  return { sig, sendMs: Math.round(t1 - t0), confirmMs: Math.round(performance.now() - t1) };
}

export async function confirmFast(
  conn: Connection,
  sig: string,
  { pollMs = 25, timeoutMs = 15_000 }: { pollMs?: number; timeoutMs?: number } = {},
) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const { value } = await conn.getSignatureStatuses([sig]);
    const st = value[0];
    if (st) {
      if (st.err) throw new Error(`tx ${sig} failed: ${JSON.stringify(st.err)}`);
      if (st.confirmationStatus === "confirmed" || st.confirmationStatus === "finalized") return;
    }
    if (Date.now() > deadline) throw new Error(`tx ${sig} not confirmed within ${timeoutMs} ms`);
    await sleep(pollMs);
  }
}

export async function sendBase(
  base: Connection,
  ixs: TransactionInstruction[],
  signers: Signer[],
): Promise<string> {
  const { blockhash, lastValidBlockHeight } = await base.getLatestBlockhash("confirmed");
  const tx = new Transaction({ feePayer: signers[0].publicKey, blockhash, lastValidBlockHeight }).add(...ixs);
  tx.sign(...signers);
  const sig = await base.sendRawTransaction(tx.serialize(), { skipPreflight: false });
  await base.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
  return sig;
}

// ---------------------------------------------------------------------------------------------
// Session keys (session-keys program KeyspM2ss..., SessionTokenV2)
// ---------------------------------------------------------------------------------------------
/**
 * Build the createSessionV2 instruction. Both the wallet (authority + fee payer) and the fresh
 * ephemeral session keypair must sign. `validUntil` is unix seconds and must be <= now + 7 days
 * on-chain (SessionError::ValidityTooLong). `topUpLamports` is a one-off transfer wallet -> session signer.
 */
export async function createSessionIx(
  conn: Connection,
  wallet: Keypair,
  targetProgram: PublicKey,
  sessionSigner: PublicKey,
  validUntilUnix: number,
  topUpLamports: number,
): Promise<TransactionInstruction> {
  // gum-sdk bundles its own @coral-xyz/anchor 0.30.1, hence the cast
  const mgr = new SessionTokenManager(new Wallet(wallet) as never, conn);
  return await mgr.program.methods
    .createSessionV2(topUpLamports > 0, new BN(validUntilUnix), new BN(topUpLamports))
    .accounts({
      targetProgram,
      sessionSigner,
      feePayer: wallet.publicKey,
      authority: wallet.publicKey,
    } as never)
    .instruction();
}

export async function revokeSessionIx(
  conn: Connection,
  wallet: Keypair,
  sessionToken: PublicKey,
): Promise<TransactionInstruction> {
  const mgr = new SessionTokenManager(new Wallet(wallet) as never, conn);
  return await mgr.program.methods
    .revokeSessionV2()
    .accounts({ sessionToken, feePayer: wallet.publicKey, authority: wallet.publicKey } as never)
    .instruction();
}

// ---------------------------------------------------------------------------------------------
// Realtime: subscribe to account changes on the ER websocket
// ---------------------------------------------------------------------------------------------
export function watchBattle(
  er: Connection,
  program: Program<ErVrf>,
  pda: PublicKey,
  onChange: (b: anchor.IdlAccounts<ErVrf>["battle"], slot: number) => void,
): () => Promise<void> {
  const id = er.onAccountChange(
    pda,
    (info, ctx) => onChange(program.coder.accounts.decode("battle", info.data), ctx.slot),
    "confirmed",
  );
  return () => er.removeAccountChangeListener(id);
}

/** poll an account on `conn` until `pred(decoded)` is true (ER clones the delegated account asynchronously) */
export async function waitFor<T>(
  fn: () => Promise<T | null | undefined | false>,
  { timeoutMs = 30_000, pollMs = 100, label = "condition" } = {},
): Promise<T> {
  const t0 = Date.now();
  for (;;) {
    const v = await fn().catch(() => null);
    if (v) return v;
    if (Date.now() - t0 > timeoutMs) throw new Error(`timeout (${timeoutMs} ms) waiting for ${label}`);
    await sleep(pollMs);
  }
}

export const lamportsToSol = (l: number | bigint) => Number(l) / 1e9;
