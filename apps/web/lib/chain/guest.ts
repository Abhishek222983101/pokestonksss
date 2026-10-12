import { Keypair } from '@solana/web3.js';
import { keypairSigner, type TxSigner } from '@pokestonksss/sdk';

const KEY = 'pokestonksss.guestkey.v1';
let mem: Keypair | null = null;

/** Devnet-only burner identity kept in this browser. Falls back to memory when storage is blocked. */
export function guestKeypair(): Keypair {
  if (mem) return mem;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw) { mem = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw))); return mem; }
  } catch { /* fall through to a fresh key */ }
  mem = Keypair.generate();
  try { window.localStorage.setItem(KEY, JSON.stringify(Array.from(mem.secretKey))); } catch { /* memory only */ }
  return mem;
}

export const guestSigner = (): TxSigner => keypairSigner(guestKeypair());

export function forgetGuest() {
  mem = null;
  try { window.localStorage.removeItem(KEY); } catch { /* ignore */ }
}
