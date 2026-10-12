import type { Champion, MatchState, Mood, Side, Slot, TurnEvent } from './rules';

/** One resolved turn, as the scene plays it. */
export interface TurnRecord {
  /** 1-based turn number (== state.turn after the turn). */
  turn: number;
  picks: [Slot, Slot];
  events: TurnEvent[];
  /** Match state after this turn. */
  state: MatchState;
}

export interface BattleResult {
  winner: Side;
  turns: number;
  ratingBefore: number;
  ratingAfter: number;
  /** Chain builds fill this in with the explorer link ("Saved to Solana"). */
  signature?: string;
  /** XP and level of the creature used, before and after this battle (chain battles). */
  progress?: { species: number; xpBefore: number; xpAfter: number; levelBefore: number; levelAfter: number };
  /** Badge ids minted to the player's wallet because of this battle (filled in a few seconds after the result). */
  badges?: number[];
}

export type BattlePhase = 'PICKING' | 'RESOLVING' | 'FINISHED';

export interface BattleSnapshot {
  /** True when this battle runs on the Ephemeral Rollup (shows proof/saved lines). */
  onChain?: boolean;
  phase: BattlePhase;
  /** Champions for side 0 (always the local player) and side 1. */
  champions: [Champion, Champion];
  /** Opponent label shown on the VS screen / dialog ("House Agent"). */
  opponent: { label: string; isBot: boolean };
  /** Current match state (after the last RESOLVED turn). */
  state: MatchState;
  /** Mood for the NEXT turn (from price move since the bell). */
  mood: [Mood, Mood];
  /** Price move since the bell, in percent, per side (informational). */
  movePct: [number, number];
  /** True once the local player has locked a pick for the current turn. */
  locked: boolean;
  /** Every resolved turn, in order. The scene plays the ones it has not shown yet. */
  turns: TurnRecord[];
  result: BattleResult | null;
  /** Milliseconds allowed per pick (UI countdown). */
  turnMs: number;
}

/**
 * The only thing BattleScene talks to. `LocalBattleSource` runs the rules in the browser against the House
 * Agent; `ChainBattleSource` (P7) drives the same snapshot from the Ephemeral Rollup Arena account.
 */
export interface BattleSource {
  getSnapshot(): BattleSnapshot;
  /** Fires after any snapshot change. Returns an unsubscribe function. */
  subscribe(cb: (s: BattleSnapshot) => void): () => void;
  /** Lock the local player's pick (slot 0-3) for the current turn. Resolves when the pick is accepted. */
  lock(slot: Slot): Promise<void>;
  /** Optional sealed-pick reveal step (commit-reveal duels). Local source does not need it. */
  reveal?(): Promise<void>;
  /** Forfeit / leave. */
  leave(): Promise<void>;
}
