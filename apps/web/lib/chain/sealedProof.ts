import { create } from 'zustand';

export interface SealedStep { id: string; label: string; link?: string; ms?: number; note?: string; at: number }

/** Everything the Proof panel shows for a Private ER (TEE) duel. */
interface SealedProofState {
  duel: string | null;
  /** The host's match key (the duel PDA is derived from it). */
  host: string | null;
  seed: string | null;
  steps: SealedStep[];
  /** Permission account of my pick as stored on the TEE: who may read it. */
  myPermission: { account: string; members: string[]; isPrivate: boolean } | null;
  /** Result of trying to read the opponent's sealed pick with my own token. */
  peek: { at: number; mine: boolean; theirs: boolean; anon: boolean } | null;
  committed: { link: string; ms?: number } | null;
  reset: () => void;
  patch: (p: Partial<Omit<SealedProofState, 'reset' | 'patch' | 'step'>>) => void;
  step: (s: Omit<SealedStep, 'at'>) => void;
}

export const useSealedProof = create<SealedProofState>((set) => ({
  duel: null, host: null, seed: null, steps: [], myPermission: null, peek: null, committed: null,
  reset: () => set({ duel: null, host: null, seed: null, steps: [], myPermission: null, peek: null, committed: null }),
  patch: (p) => set(p),
  step: (s) => set((st) => ({ steps: [...st.steps.filter((x) => x.id !== s.id), { ...s, at: Date.now() }] })),
}));
