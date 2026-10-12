import { Keypair, PublicKey, Transaction } from '@solana/web3.js';
import { requestDrip, trainerPda } from '@pokestonksss/sdk';
import { FAUCET_URL, getClient } from './config';
import { saveWalletSession, walletSession, type WalletSession } from './guest';

/** The slice of a wallet adapter the game needs. */
export interface WalletLike {
  publicKey: PublicKey;
  signTransaction: <T extends Transaction>(tx: T) => Promise<T>;
  name?: string;
}

export type LinkStep = 'funding' | 'creating' | 'session' | 'delegating' | 'cloning' | 'ready';
const DELEGATION_PROGRAM = new PublicKey('DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh');
const SESSION_SECONDS = 6 * 24 * 3600 + 20 * 3600; // under the on-chain 7 day cap
const MIN_BALANCE = 25_000_000;

export interface LinkResult { session: WalletSession; sig?: string; link?: string; created: boolean }

/**
 * Connects a wallet to the game with ONE approval: a single base-layer transaction that (when missing) creates the
 * wallet's Trainer + Arena, delegates them to the MagicBlock rollup and registers a fresh session key. After that the
 * session key signs every move, so nothing pops up during a fight.
 */
export async function linkWallet(w: WalletLike, avatar: number, onStep: (s: LinkStep, extra?: { link?: string; ms?: number }) => void = () => {}): Promise<LinkResult> {
  const client = getClient();
  const owner = w.publicKey;
  const T = trainerPda(owner, client.cfg.programId);

  // Existing session for this wallet that still works: nothing to sign.
  const have = walletSession();
  if (have && have.wallet === owner.toBase58()) {
    const kp = Keypair.fromSecretKey(Uint8Array.from(have.secret));
    const [live, onEr] = await Promise.all([client.sessionActive(kp.publicKey, owner), client.er.getAccountInfo(T)]);
    if (live && onEr) { onStep('ready'); return { session: have, created: false }; }
  }

  const [baseT, erT, balance] = await Promise.all([client.base.getAccountInfo(T), client.er.getAccountInfo(T), client.base.getBalance(owner)]);
  if (balance < MIN_BALANCE) {
    onStep('funding');
    const r = await requestDrip(FAUCET_URL, owner.toBase58());
    if (!r.ok) throw new Error(r.error ?? 'The devnet faucet is busy. Try again in a minute.');
    for (let i = 0; i < 40 && (await client.base.getBalance(owner)) < MIN_BALANCE; i++) await new Promise((x) => setTimeout(x, 250));
  }

  const sessionKp = Keypair.generate();
  const ixs = [];
  const created = !baseT && !erT;
  if (created) ixs.push(await client.onboardIx(owner, undefined, avatar));
  const delegated = erT || (baseT && baseT.owner.equals(DELEGATION_PROGRAM));
  if (!delegated) ixs.push(await client.delegateIx(owner));
  const validUntil = Math.floor(Date.now() / 1000) + SESSION_SECONDS;
  ixs.push(client.createSessionIx(owner, sessionKp.publicKey, validUntil));

  onStep('creating');
  const { blockhash, lastValidBlockHeight } = await client.base.getLatestBlockhash('confirmed');
  const tx = new Transaction({ feePayer: owner, blockhash, lastValidBlockHeight }).add(...ixs);
  // wallet first, then the extra signer (wallets may rewrite the message, e.g. to add guard instructions)
  const signed = await w.signTransaction(tx);
  signed.partialSign(sessionKp);
  onStep('session');
  const t0 = performance.now();
  const sig = await client.base.sendRawTransaction(signed.serialize());
  await client.base.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');
  const link = `https://explorer.solana.com/tx/${sig}?cluster=devnet`;
  onStep('delegating', { link, ms: Math.round(performance.now() - t0) });
  onStep('cloning');
  await client.waitCloned(owner);

  const session: WalletSession = { wallet: owner.toBase58(), secret: Array.from(sessionKp.secretKey), until: validUntil, walletName: w.name };
  saveWalletSession(session);
  onStep('ready');
  return { session, sig, link, created };
}
