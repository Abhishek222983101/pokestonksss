import { create } from 'zustand';
import { BADGES, badgesEarned, txLink, type TrainerView } from '@pokestonksss/sdk';
import { getClient } from './config';
import { ownerKey } from './guest';

export interface MintedBadge { id: number; sig?: string; link?: string; at: number }

interface RewardState {
  /** Badge ids with a claim record on Solana (already in the owner's wallet). */
  claimed: number[];
  /** Mint transactions made in this session (for the receipts list). */
  minted: MintedBadge[];
  /** Newly minted this battle: drives the "badge earned" banner. */
  fresh: number[];
  syncing: boolean;
  error: string | null;
  lastSyncedFor: string | null;
  clearFresh: () => void;
  /** Reads what is already minted (no transactions). */
  load: () => Promise<void>;
  /** Waits for the saved (committed) Trainer on Solana, then mints every badge it qualifies for. */
  sync: (expect?: Pick<TrainerView, 'wins' | 'xp'>) => Promise<number[]>;
}

export const useRewards = create<RewardState>((set, get) => ({
  claimed: [], minted: [], fresh: [], syncing: false, error: null, lastSyncedFor: null,
  clearFresh: () => set({ fresh: [] }),
  load: async () => {
    try { set({ claimed: await getClient().claimedBadges(ownerKey()) }); } catch { /* offline: keep what we have */ }
  },
  sync: async (expect) => {
    if (get().syncing) return [];
    set({ syncing: true, error: null });
    const client = getClient();
    const owner = ownerKey();
    const newly: number[] = [];
    try {
      // The mint reads the committed copy on Solana: wait (up to ~12 s) until it matches the rollup.
      let base: TrainerView | null = null;
      for (let i = 0; i < 24; i++) {
        base = await client.getTrainer(owner, 'base');
        const ok = base && (!expect || (base.wins >= expect.wins && base.xp.reduce((a, b) => a + b, 0) >= expect.xp.reduce((a, b) => a + b, 0)));
        if (ok) break;
        await new Promise((r) => setTimeout(r, 500));
      }
      if (!base) { set({ syncing: false }); return []; }
      const have = new Set(await client.claimedBadges(owner));
      const earned = badgesEarned(base);
      for (const b of BADGES) {
        if (!earned[b.id] || have.has(b.id)) continue;
        try {
          const res = await fetch('/api/badge', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ owner: owner.toBase58(), id: b.id }) });
          const j = (await res.json().catch(() => ({}))) as { ok?: boolean; sig?: string; error?: string; already?: boolean };
          if (j.ok) {
            have.add(b.id);
            if (!j.already) {
              newly.push(b.id);
              set((s) => ({ minted: [...s.minted, { id: b.id, sig: j.sig, link: j.sig ? txLink(j.sig, 'base', client.cfg) : undefined, at: Date.now() }] }));
            }
          } else set({ error: j.error ?? 'badge relayer unavailable' });
        } catch (e) { set({ error: String((e as Error).message) }); }
      }
      set({ claimed: [...have].sort((a, b) => a - b), fresh: [...get().fresh, ...newly], lastSyncedFor: owner.toBase58() });
    } finally { set({ syncing: false }); }
    return newly;
  },
}));
