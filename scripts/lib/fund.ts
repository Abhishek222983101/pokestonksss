import { readFileSync, existsSync } from "node:fs";
import { Keypair, PublicKey, SystemProgram, Transaction, Connection } from "@solana/web3.js";
import { homedir } from "node:os";

/** Test-only funding from the local deployer keypair FILE (never printed). Used by devnet scripts when the public airdrop is dry. */
export async function fundFromDeployer(conn: Connection, to: PublicKey, lamports: number): Promise<boolean> {
  const p = `${homedir()}/.config/solana/blitz-deployer.json`;
  if (!existsSync(p)) return false;
  const kp = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(p, "utf8"))));
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
  const tx = new Transaction({ feePayer: kp.publicKey, blockhash, lastValidBlockHeight }).add(SystemProgram.transfer({ fromPubkey: kp.publicKey, toPubkey: to, lamports }));
  tx.sign(kp);
  const sig = await conn.sendRawTransaction(tx.serialize());
  await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
  return true;
}
