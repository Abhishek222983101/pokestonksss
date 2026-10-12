import { PublicKey } from '@solana/web3.js';
import { GameClient, PHASE, type ArenaView } from '@pokestonksss/sdk';
import { getClient } from './config';
import { ownerKey, activeSigner } from './guest';
import { friendly } from './store';

const b64u = (u: Uint8Array) => btoa(String.fromCharCode(...u)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

export const inviteUrl = (origin: string, host: PublicKey, token: Uint8Array, species: number) => `${origin}/d/${host.toBase58()}?s=${species}#${b64u(token)}`;
export const parseToken = (hash: string): Uint8Array | null => { try { const t = unb64u(hash.replace(/^#/, '')); return t.length === 32 ? t : null; } catch { return null; } };

/** Host: open the duel and wait for a guest. Returns the share link and a promise that resolves with the joined arena. */
export async function hostDuel(species: number, origin: string) {
  const client = getClient();
  const token = GameClient.newToken();
  await client.openDuel(activeSigner(), species, token);
  const host = ownerKey();
  const link = inviteUrl(origin, host, token, species);
  const joined = new Promise<ArenaView>((resolve, reject) => {
    const stop = client.watchArena(host, (a) => { if (a.phase === PHASE.PICKING && a.guest !== PublicKey.default.toBase58()) { stop(); resolve(a); } });
    setTimeout(() => { stop(); reject(new Error('Nobody joined within 10 minutes.')); }, 600_000);
  });
  return { link, host, token, joined, cancel: () => client.cancelDuel(activeSigner()).catch(() => undefined) };
}

/** Guest: join via the invite token. Throws a friendly error on a stale/invalid invite. */
export async function joinDuel(host: PublicKey, hostSpecies: number, mySpecies: number, token: Uint8Array) {
  try { return await getClient().joinDuel(activeSigner(), host, hostSpecies, mySpecies, token); }
  catch (e) { throw new Error(/BadToken|6003|InviteExpired|WrongPhase/i.test(String((e as Error).message)) ? 'This invite is no longer valid. Ask your friend for a new link.' : friendly(e)); }
}
