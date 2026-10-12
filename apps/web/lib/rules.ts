/**
 * Rules bridge. This is the ONLY module the UI imports for game rules.
 *
 * Until `packages/rules-wasm` exists, `rules` is backed by the temporary TypeScript port of docs/RULES.md in
 * `./rulesTs.ts`. Swapping to WASM later means replacing the import at the bottom of this file with the
 * wasm wrapper (same `RulesApi` shape) - nothing else in the app changes.
 */

export const TYPE_NAMES = ['SPEED', 'ARMOR', 'ARCANE', 'TIDE', 'SHADE'] as const;
export type TypeId = 0 | 1 | 2 | 3 | 4;
export type TypeName = (typeof TYPE_NAMES)[number];

export const MAX_TURNS = 16;

export type MoveKind = 'strike' | 'guard' | 'charge';
export type Slot = 0 | 1 | 2 | 3;
export type Side = 0 | 1;
/** Market mood from the live price move since the bell: -1 bear, 0 flat, +1 bull. */
export type Mood = -1 | 0 | 1;

export interface MoveDef {
  slot: Slot;
  /** UI vocabulary: strike=Pump, guard=Hedge, charge=Leverage. */
  name: string;
  kind: MoveKind;
  type: TypeId;
  power: number;
  acc: number;
}

export interface Champion {
  id: number;
  name: string;
  /** Oracle ticker. */
  asset: string;
  type: TypeId;
  hp: number;
  atk: number;
  def: number;
  spd: number;
  moves: [MoveDef, MoveDef, MoveDef, MoveDef];
}

export interface FighterState {
  champ: number;
  hp: number;
  maxHp: number;
  charged: boolean;
  lastGuard: boolean;
}

export interface MatchState {
  turn: number;
  fighters: [FighterState, FighterState];
}

/** Ordered animation events for one resolved turn. `hp` is both sides' margin AFTER the event. */
export type TurnEvent =
  | { kind: 'mood'; side: Side; mood: Mood }
  | { kind: 'guard'; side: Side; heal: number; hp: [number, number] }
  | { kind: 'charge'; side: Side; hp: [number, number] }
  | { kind: 'miss'; side: Side; slot: Slot; hp: [number, number] }
  | { kind: 'hit'; side: Side; slot: Slot; dmg: number; crit: boolean; eff: 50 | 100 | 200; hp: [number, number] }
  | { kind: 'ko'; side: Side };

export interface TurnResult {
  state: MatchState;
  events: TurnEvent[];
  /** Winning side once the match is over, else null. */
  winner: Side | null;
}

export interface DamagePreview { min: number; max: number; eff: 50 | 100 | 200 }

export interface ReplayTurn { picks: [Slot, Slot]; rnd: Uint8Array; mood: [Mood, Mood] }

export interface RulesApi {
  roster(): Champion[];
  newMatch(a: number, b: number): MatchState;
  resolveTurn(state: MatchState, picks: [Slot, Slot], rnd: Uint8Array, mood: [Mood, Mood]): TurnResult;
  /** House Agent pick for `side`. Reads only public state; never the opponent's pick. */
  botPick(state: MatchState, side: Side, rnd: Uint8Array): Slot;
  previewDamage(state: MatchState, side: Side, slot: Slot): DamagePreview;
  replay(a: number, b: number, turns: ReplayTurn[]): TurnResult;
  /** Integer Elo, K=24. Returns the new rating. */
  elo(rating: number, opponent: number, won: boolean): number;
}

export { rules, initRules } from './rulesWasm';

import { rules as impl } from './rulesWasm';

export const getChampion = (id: number): Champion => impl.roster()[id] ?? impl.roster()[0];
export const typeName = (t: TypeId): TypeName => TYPE_NAMES[t];
export function effectiveness(att: TypeId, def: TypeId): 50 | 100 | 200 {
  const d = (def - att + 5) % 5;
  return d === 0 ? 100 : d === 1 || d === 2 ? 200 : 50;
}
