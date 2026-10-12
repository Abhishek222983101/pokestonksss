import { Keypair, PublicKey } from '@solana/web3.js';
import { SEALED, SealedClient, keypairSigner, requestDrip, type SealedDuelView, type TeeSession } from '@pokestonksss/sdk';
import { FAUCET_URL, getClient } from './config';
import { useSealedProof } from './sealedProof';
import { friendly } from './store';

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
}

const b64u = (u: Uint8Array) => btoa(String.fromCharCode(...u)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
export const sealedInviteUrl = (origin: string, host: PublicKey, token: Uint8Array, species: number) => `${origin}/p/${host.toBase58()}?s=${species}#${b64u(token)}`;
export const parseSealedToken = (hash: string): Uint8Array | null => { try { const t = unb64u(hash.replace(/^#/, '')); return t.length === 32 ? t : null; } catch { return null; } };

let sc: SealedClient | null = null;
export const getSealed = () => (sc ??= new SealedClient(getClient()));

// ---- per-match keys: a throwaway identity per private duel, never linked to a wallet or guest key
const keyName = (host: string, role: 'host' | 'guest') => `pokestonksss.sealedkey.v1.${host}.${role}`;
const mem = new Map<string, Keypair>();
export function matchKey(host: string, role: 'host' | 'guest', create: boolean): Keypair | null {
  const k = keyName(host, role);
  const hit = mem.get(k);
  if (hit) return hit;
  try { const raw = window.localStorage.getItem(k); if (raw) { const kp = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw))); mem.set(k, kp); return kp; } } catch { /* fall through */ }
  if (!create) return null;
  const kp = Keypair.generate();
  mem.set(k, kp);
  try { window.localStorage.setItem(k, JSON.stringify(Array.from(kp.secretKey))); } catch { /* memory only */ }
  return kp;
}
/** The host's key is the duel's PDA seed, so a new host key is generated first and stored under its own pubkey. */
export function newHostKey(): Keypair {
  const kp = Keypair.generate();
  const host = kp.publicKey.toBase58();
  mem.set(keyName(host, 'host'), kp);
  try { window.localStorage.setItem(keyName(host, 'host'), JSON.stringify(Array.from(kp.secretKey))); } catch { /* memory only */ }
  return kp;
}

export async function fundKey(pk: PublicKey) {
  const client = getClient();
  if ((await client.base.getBalance(pk)) >= 15_000_000) return;
  let last = 'faucet unavailable';
  for (let i = 0; i < 3; i++) {
    const r = await requestDrip(FAUCET_URL, pk.toBase58());
    if (r.ok) { for (let k = 0; k < 40 && (await client.base.getBalance(pk)) < 15_000_000; k++) await new Promise((x) => setTimeout(x, 250)); return; }
    last = r.error ?? last;
    await new Promise((x) => setTimeout(x, 1500 * (i + 1)));
  }
  throw new Error(last);
}

const P = () => useSealedProof.getState();

/** Host: create the duel on the base layer with a fresh match key. Returns the invite link and a promise for the guest. */
export async function hostSealed(species: number, origin: string) {
  const sealed = getSealed();
  P().reset();
  const kp = newHostKey();
  const signer = keypairSigner(kp);
  const t0 = performance.now();
  await fundKey(kp.publicKey);
  const token = SealedClient.newToken();
  const r = await sealed.create(signer, species, token);
  P().patch({ duel: sealed.duel(kp.publicKey).toBase58(), host: kp.publicKey.toBase58() });
  P().step({ id: 'create', label: 'create_duel (base layer)', link: r.link, ms: r.ms });
  const link = sealedInviteUrl(origin, kp.publicKey, token, species);
  const joined = new Promise<SealedDuelView>((resolve, reject) => {
    const poll = async () => {
      const deadline = Date.now() + 900_000;
      while (Date.now() < deadline) {
        const d = await sealed.readDuel(kp.publicKey, 'base').catch(() => null);
        if (d && d.status >= SEALED.JOINED) return resolve(d);
        await new Promise((x) => setTimeout(x, 1200));
      }
      reject(new Error('Nobody joined within 15 minutes.'));
    };
    void poll();
  });
  return { link, host: kp.publicKey, kp, joined, ms: Math.round(performance.now() - t0), cancel: () => sealed.cancel(signer).catch(() => undefined) };
}

export type SetupStep = 'seed' | 'delegate' | 'tee' | 'open' | 'ready';

/** Host, after the guest joined: VRF seed, delegate to the TEE, auth, clone, private permissions. */
export async function openSealed(kp: Keypair, players: [PublicKey, PublicKey], onStep: (s: SetupStep) => void): Promise<TeeSession> {
  const sealed = getSealed();
  const signer = keypairSigner(kp);
  const host = kp.publicKey;
  onStep('seed');
  // devnet can drop a transaction or delay the VRF callback: retry both steps (each is safe to repeat)
  let seeded: SealedDuelView | null = null;
  for (let attempt = 0; attempt < 3 && !seeded; attempt++) {
    const cur = await sealed.readDuel(host, 'base').catch(() => null);
    if (cur && cur.status >= SEALED.SEEDED) { seeded = cur; break; }
    try {
      const rs = await sealed.requestSeed(signer, host);
      P().step({ id: 'seed', label: 'request_seed (MagicBlock VRF, base layer)', link: rs.link, ms: rs.ms });
    } catch { /* a repeated request may fail once the first callback landed: re-read below */ }
    seeded = await sealed.waitSeeded(host, 25_000).catch(() => null);
  }
  if (!seeded) throw new Error('The MagicBlock VRF seed did not arrive. Please try again.');
  P().patch({ seed: seeded.seed });
  onStep('delegate');
  const dutyKey = sealed.duel(host);
  for (let attempt = 0; attempt < 3; attempt++) {
    const info = await getClient().base.getAccountInfo(dutyKey).catch(() => null);
    if (info && !info.owner.equals(getClient().cfg.programId)) break; // already delegated
    try {
      const del = await withTimeout(sealed.delegateAll(signer, host, players), 35_000);
      P().step({ id: 'delegate', label: 'delegate duel + 2 picks to the TEE validator', link: del.link, ms: del.ms });
      break;
    } catch (e) { if (attempt === 2) throw new Error(`Could not move the duel into the private rollup: ${friendly(e)}`); }
  }
  onStep('tee');
  const tee = await sealed.connect(kp);
  P().step({ id: 'auth', label: 'TEE login: challenge signed by the match key', note: 'JWT token, no wallet involved' });
  await sealed.waitCloned(tee.conn, host, players);
  onStep('open');
  const op = await sealed.open(tee.conn, signer, host, players);
  P().step({ id: 'open', label: 'open: private permissions on both picks (TEE)', link: op.link, ms: op.ms });
  onStep('ready');
  return tee;
}

/** Guest: join with the invite token. */
export async function joinSealed(host: PublicKey, species: number, token: Uint8Array) {
  const sealed = getSealed();
  P().reset();
  const kp = matchKey(host.toBase58(), 'guest', true)!;
  await fundKey(kp.publicKey);
  const r = await sealed.join(keypairSigner(kp), host, species, token);
  P().patch({ duel: sealed.duel(host).toBase58(), host: host.toBase58() });
  P().step({ id: 'join', label: 'join_duel (base layer)', link: r.link, ms: r.ms });
  return { kp, host };
}

/** Guest: wait until the host has delegated and opened the duel, then log into the TEE. */
export async function awaitLive(kp: Keypair, host: PublicKey, players: [PublicKey, PublicKey], onStep: (s: SetupStep) => void): Promise<TeeSession> {
  const sealed = getSealed();
  onStep('seed');
  await sealed.waitSeeded(host, 120_000);
  onStep('delegate');
  const tee = await sealed.connect(kp);
  P().step({ id: 'auth', label: 'TEE login: challenge signed by the match key', note: 'JWT token, no wallet involved' });
  await sealed.waitCloned(tee.conn, host, players, 120_000);
  onStep('open');
  const t0 = Date.now();
  for (;;) {
    const d = await sealed.readDuel(host, tee.conn).catch(() => null);
    if (d && d.status === SEALED.LIVE) break;
    if (Date.now() - t0 > 120_000) throw new Error('The host did not open the duel in time.');
    await new Promise((x) => setTimeout(x, 400));
  }
  onStep('ready');
  return tee;
}
