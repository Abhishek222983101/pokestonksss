import { create } from 'zustand';

export interface Receipt { label: string; sig: string; link: string; ms?: number }

/** Everything the Proof Strip (Weighed · Sealed · Rolled · Saved) shows for the current battle. */
interface ProofState {
  weighed: { snap: [string, string]; now: [string, string]; mood: [number, number] } | null;
  sealed: Receipt[];
  rolled: Array<Receipt & { rnd?: string }>;
  saved: Receipt | null;
  start: Receipt | null;
  /** The crank task armed for the current duel. */
  crank: Receipt | null;
  reset: () => void;
  set: (p: Partial<Omit<ProofState, 'reset' | 'set'>>) => void;
  addRolled: (r: Receipt & { rnd?: string }) => void;
  addSealed: (r: Receipt) => void;
}

export const useProof = create<ProofState>((set) => ({
  weighed: null, sealed: [], rolled: [], saved: null, start: null, crank: null,
  reset: () => set({ weighed: null, sealed: [], rolled: [], saved: null, start: null, crank: null }),
  set: (p) => set(p),
  addRolled: (r) => set((s) => ({ rolled: [...s.rolled, r] })),
  addSealed: (r) => set((s) => ({ sealed: [...s.sealed, r] })),
}));
