import { Keypair, PublicKey } from '@solana/web3.js';
import { keypairSigner, sessionSigner, sessionTokenPda, PROGRAM_ID, type TxSigner } from '@pokestonksss/sdk';

const KEY = 'pokestonksss.guestkey.v1';
const WALLET_KEY = 'pokestonksss.walletsession.v1';
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

// ------------------------------------------------------------------------------------------------ wallet + session key
/** A connected wallet's MagicBlock session: an ephemeral key that signs moves for the wallet until `until` (unix s). */
export interface WalletSession { wallet: string; secret: number[]; until: number; walletName?: string }
let walletMem: WalletSession | null | undefined;

export function walletSession(): WalletSession | null {
  if (walletMem === undefined) {
    try { const raw = window.localStorage.getItem(WALLET_KEY); walletMem = raw ? (JSON.parse(raw) as WalletSession) : null; } catch { walletMem = null; }
  }
  if (walletMem && walletMem.until < Date.now() / 1000 + 60) return null; // expired or about to
  return walletMem ?? null;
}
export function saveWalletSession(s: WalletSession) {
  walletMem = s;
  try { window.localStorage.setItem(WALLET_KEY, JSON.stringify(s)); } catch { /* memory only */ }
}
export function clearWalletSession() {
  walletMem = null;
  try { window.localStorage.removeItem(WALLET_KEY); } catch { /* ignore */ }
}

export type IdentityKind = 'guest' | 'wallet';
export const identityKind = (): IdentityKind => (walletSession() ? 'wallet' : 'guest');

/** Who owns the Trainer: the connected wallet, else this device's guest key. */
export function ownerKey(): PublicKey {
  const w = walletSession();
  return w ? new PublicKey(w.wallet) : guestKeypair().publicKey;
}

/** What signs game transactions: the wallet's session key (no popups) or the guest key. */
export function activeSigner(): TxSigner {
  const w = walletSession();
  if (!w) return guestSigner();
  const kp = Keypair.fromSecretKey(Uint8Array.from(w.secret));
  const owner = new PublicKey(w.wallet);
  return sessionSigner(kp, owner, sessionTokenPda(kp.publicKey, owner, PROGRAM_ID));
}

// ------------------------------------------------------------------------------------------------ avatar
const AVATAR_KEY = 'pokestonksss.avatar.v1';
/** Avatar picked before the guest Trainer is created (0..5). Stored on chain at creation. */
export function pendingAvatar(): number {
  try { const v = Number(window.localStorage.getItem(AVATAR_KEY)); return Number.isInteger(v) && v >= 0 && v < 6 ? v : 0; } catch { return 0; }
}
export function setPendingAvatar(v: number) {
  try { window.localStorage.setItem(AVATAR_KEY, String(v)); } catch { /* ignore */ }
}
