import { create } from 'zustand';
import { ensureReady, requestDrip, tierName, type OnboardEvent, type TrainerView } from '@pokestonksss/sdk';
import { FAUCET_URL, getClient } from './config';
import { guestSigner, guestKeypair } from './guest';

export type ChainStatus = 'idle' | 'working' | 'ready' | 'error';
export interface StepLog { step: OnboardEvent['step']; at: number; link?: string; ms?: number }

interface ChainState {
  status: ChainStatus;
  steps: StepLog[];
  error: string | null;
  address: string | null;
  trainer: TrainerView | null;
  tier: string;
  /** Idempotent: safe to call repeatedly (resumes from whatever is already on-chain). */
  boot: () => Promise<void>;
  refreshTrainer: () => Promise<TrainerView | null>;
}

let booting: Promise<void> | null = null;

export const useChain = create<ChainState>((set, get) => ({
  status: 'idle', steps: [], error: null, address: null, trainer: null, tier: 'Shrimp',
  boot: () => {
    if (get().status === 'ready') return Promise.resolve();
    if (booting) return booting;
    booting = (async () => {
      const client = getClient();
      const signer = guestSigner();
      set({ status: 'working', error: null, address: guestKeypair().publicKey.toBase58(), steps: [] });
      try {
        await ensureReady({
          client, signer,
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
        set({ status: 'ready' });
        await get().refreshTrainer();
      } catch (e) {
        set({ status: 'error', error: friendly(e) });
      } finally {
        booting = null;
      }
    })();
    return booting;
  },
  refreshTrainer: async () => {
    try {
      const t = await getClient().getTrainer(guestKeypair().publicKey);
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
