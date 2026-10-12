import { create } from 'zustand';
import { ensureReady, requestDrip, tierName, trainerPda, type OnboardEvent, type TrainerView } from '@pokestonksss/sdk';
import { FAUCET_URL, getClient } from './config';
import { activeSigner, clearWalletSession, identityKind, ownerKey, pendingAvatar, type IdentityKind } from './guest';
import { linkWallet, type WalletLike } from './wallet';
import { useRewards } from './rewards';

export type ChainStatus = 'idle' | 'working' | 'ready' | 'error';
export interface StepLog { step: OnboardEvent['step']; at: number; link?: string; ms?: number }
export type { IdentityKind };

interface ChainState {
  status: ChainStatus;
  steps: StepLog[];
  error: string | null;
  address: string | null;
  /** Who plays: a wallet (session key signs, no popups) or this device's guest key. */
  identity: IdentityKind;
  notice: string | null;
  trainer: TrainerView | null;
  tier: string;
  /** Idempotent: safe to call repeatedly (resumes from whatever is already on-chain). */
  boot: () => Promise<void>;
  /** Link a connected wallet: one approval creates/delegates the Trainer and registers a session key. */
  connectWallet: (w: WalletLike, avatar: number) => Promise<boolean>;
  /** Drop the wallet session and go back to the guest identity on this device. */
  useGuest: () => void;
  refreshTrainer: () => Promise<TrainerView | null>;
}

let booting: Promise<void> | null = null;

export const useChain = create<ChainState>((set, get) => ({
  status: 'idle', steps: [], error: null, address: null, identity: 'guest', notice: null, trainer: null, tier: 'Shrimp',
  boot: () => {
    if (get().status === 'ready') return Promise.resolve();
    if (booting) return booting;
    booting = (async () => {
      const client = getClient();
      set({ status: 'working', error: null, steps: [], notice: null });
      try {
        // A wallet session that expired or lost its rollup account falls back to the guest key (never a dead screen).
        let kind = identityKind();
        if (kind === 'wallet') {
          const signer = activeSigner();
          const owner = ownerKey();
          const [live, onEr] = await Promise.all([client.sessionActive(signer.publicKey, owner), client.er.getAccountInfo(trainerPda(owner, client.cfg.programId))]);
          if (!live || !onEr) { clearWalletSession(); kind = 'guest'; set({ notice: 'Your wallet session ended. Playing as guest, reconnect your wallet anytime.' }); }
        }
        set({ identity: kind, address: ownerKey().toBase58() });
        if (kind === 'guest') {
          await ensureReady({
            client, signer: activeSigner(), avatar: pendingAvatar(),
            drip: async (pk) => {
              let last = 'faucet unavailable';
              for (let i = 0; i < 3; i++) {
                const r = await requestDrip(FAUCET_URL, pk);
                if (r.ok) return;
                last = r.error ?? last;
                await new Promise((x) => setTimeout(x, 1500 * (i + 1)));
              }
              throw new Error(last);
            },
            onEvent: (e) => set((s) => ({ steps: [...s.steps, { step: e.step, at: Date.now(), link: e.link, ms: e.ms }] })),
          });
        }
        set({ status: 'ready' });
        await get().refreshTrainer();
        void useRewards.getState().load();
      } catch (e) {
        set({ status: 'error', error: friendly(e) });
      } finally {
        booting = null;
      }
    })();
    return booting;
  },
  connectWallet: async (w, avatar) => {
    booting = null;
    set({ status: 'working', error: null, steps: [], notice: null, identity: 'wallet', address: w.publicKey.toBase58(), trainer: null });
    try {
      await linkWallet(w, avatar, (step, extra) => set((s) => ({ steps: [...s.steps, { step, at: Date.now(), link: extra?.link, ms: extra?.ms }] })));
      set({ status: 'ready', identity: 'wallet', address: w.publicKey.toBase58() });
      await get().refreshTrainer();
      void useRewards.getState().load();
      return true;
    } catch (e) {
      const m = String((e as Error)?.message ?? e);
      set({ status: 'error', identity: identityKind(), error: /reject|denied|cancel/i.test(m) ? 'Wallet request was cancelled. Nothing was changed.' : friendly(e) });
      return false;
    }
  },
  useGuest: () => {
    clearWalletSession();
    booting = null;
    set({ status: 'idle', identity: 'guest', trainer: null, steps: [], error: null, notice: null });
    useRewards.setState({ claimed: [], minted: [], fresh: [] });
  },
  refreshTrainer: async () => {
    try {
      const t = await getClient().getTrainer(ownerKey());
      if (t) set({ trainer: t, tier: tierName(t.rating) });
      return t;
    } catch { return null; }
  },
}));

export function friendly(e: unknown): string {
  const m = String((e as Error)?.message ?? e);
  if (/faucet|rate limited|low on devnet/i.test(m)) return 'The devnet faucet is busy. Try again in a minute.';
  if (/timeout|not confirmed/i.test(m)) return 'The network is slow right now. Retrying usually works.';
  if (/failed to fetch|network/i.test(m)) return 'Cannot reach Solana devnet. Check your connection.';
  return m.length > 140 ? m.slice(0, 140) + '…' : m;
}
