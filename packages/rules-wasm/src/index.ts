/**
 * Typed wrapper around the Rust duel rules (crates/duel-rules via crates/duel-wasm).
 * Call `await init()` once before anything else. In Node/tests pass the wasm bytes: `init(readFileSync(...))`.
 */
import wasmInit, * as wasm from '../pkg/duel_wasm.js';
import { ROSTER_DATA } from './roster-data';

export { ROSTER_DATA };

export const MAX_TURNS = 16;
export const RND_USED = 10;
export const TURN_LOG_BYTES = 14;
export const TYPES = ['SPEED', 'ARMOR', 'ARCANE', 'TIDE', 'SHADE'] as const;
export type TypeName = (typeof TYPES)[number];
export const SLOT = { SIGNATURE: 0, COVERAGE: 1, GUARD: 2, CHARGE: 3 } as const;
export const TIER = { ROOKIE: 0, PRO: 1, CHAMPION: 2 } as const;
export type Tier = 0 | 1 | 2;
export type Side = 0 | 1;
export type Pick = 0 | 1 | 2 | 3;
export type Mood = -1 | 0 | 1;

export interface FighterState {
  species: number;
  hp: number;
  maxHp: number;
  charged: boolean;
  lastGuard: boolean;
}
export interface MatchState {
  turn: number;
  /** null while running */
  winner: Side | null;
  f: [FighterState, FighterState];
}
export type RulesEvent =
  | { t: 'mood'; side: Side; mood: Mood }
  | { t: 'guard'; side: Side; heal: number }
  | { t: 'charge'; side: Side }
  | { t: 'miss'; side: Side }
  | { t: 'hit'; side: Side; dmg: number; crit: boolean; eff: 50 | 100 | 200 }
  | { t: 'ko'; side: Side }
  | { t: 'end'; winner: Side; byKo: boolean };
export interface TurnResult {
  state: MatchState;
  events: RulesEvent[];
}
/** What the chain stores per turn: picks, rnd[0..10], mood. */
export interface TurnLog {
  picks: [number, number];
  rnd: Uint8Array | number[];
  mood: [number, number];
}
export type ReplayError = 'bad_species' | 'bad_pick' | 'too_long' | 'unfinished' | 'trailing_turns' | 'bad_input';
export type ReplayResult =
  | { ok: true; winner: Side; hp: [number, number]; turns: number }
  | { ok: false; error: ReplayError };
export interface DamagePreview {
  min: number;
  max: number;
  eff: 50 | 100 | 200;
  acc: number;
}
export type Roster = typeof ROSTER_DATA;

let ready = false;

/** Load the WASM module. `input` may be wasm bytes / a Response / a URL / a WebAssembly.Module. Idempotent. */
export async function init(input?: Parameters<typeof wasmInit>[0] | Uint8Array | ArrayBuffer): Promise<void> {
  if (ready) return;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await wasmInit(input === undefined ? undefined : ({ module_or_path: input } as any));
  ready = true;
}

function need(): void {
  if (!ready) throw new Error('rules-wasm: call await init() first');
}

export function hexToBytes(h: string): Uint8Array {
  if (h.length % 2) throw new Error('odd hex');
  const o = new Uint8Array(h.length / 2);
  for (let i = 0; i < o.length; i++) o[i] = parseInt(h.slice(2 * i, 2 * i + 2), 16);
  return o;
}
export function bytesToHex(b: ArrayLike<number>): string {
  return Array.from(b as ArrayLike<number>, (x) => x.toString(16).padStart(2, '0')).join('');
}

/** Pads/validates randomness to the 32 bytes the engine takes (only the first 10 matter). */
function rnd32(rnd: ArrayLike<number>): Uint8Array {
  if (rnd.length > 32) throw new Error('rnd longer than 32 bytes');
  const o = new Uint8Array(32);
  o.set(rnd as ArrayLike<number> as number[]);
  return o;
}

/** 16-byte state encoding shared with Rust `MatchState::to_bytes`. */
export function stateToBytes(s: MatchState): Uint8Array {
  const o = new Uint8Array(16);
  o[0] = s.turn;
  o[1] = s.winner === null ? 255 : s.winner;
  s.f.forEach((f, i) => {
    const b = 2 + i * 7;
    o[b] = f.species;
    o[b + 1] = f.hp & 255;
    o[b + 2] = f.hp >> 8;
    o[b + 3] = f.maxHp & 255;
    o[b + 4] = f.maxHp >> 8;
    o[b + 5] = f.charged ? 1 : 0;
    o[b + 6] = f.lastGuard ? 1 : 0;
  });
  return o;
}

function moodBytes(m: [number, number]): Uint8Array {
  return Uint8Array.from(m, (x) => x & 255);
}

export function roster(): Roster {
  need();
  return JSON.parse(wasm.roster());
}

export function newMatch(a: number, b: number): MatchState {
  need();
  const r = JSON.parse(wasm.newMatch(a, b));
  if (r.ok === false) throw new Error(r.error);
  return r;
}

/** Pure: returns the new state and event list; throws on invalid input (bad pick, finished match). */
export function resolveTurn(state: MatchState, picks: [number, number], rnd: ArrayLike<number>, mood: [number, number] = [0, 0]): TurnResult {
  need();
  const r = JSON.parse(wasm.resolveTurn(stateToBytes(state), Uint8Array.from(picks), rnd32(rnd), moodBytes(mood)));
  if (!r.ok) throw new Error(`resolveTurn: ${r.error}`);
  return { state: r.state, events: r.events };
}

/** House Agent pick. Takes no opponent pick by design. */
export function botPick(state: MatchState, side: Side, rnd: ArrayLike<number>, tier: Tier): Pick {
  need();
  const p = wasm.botPick(stateToBytes(state), side, rnd32(rnd), tier);
  if (p < 0) throw new Error('botPick: bad input');
  return p as Pick;
}

/** Re-simulate a finished match; each log entry needs `rnd` of at least 10 bytes. */
export function replay(species: [number, number], log: TurnLog[]): ReplayResult {
  need();
  const buf = new Uint8Array(log.length * TURN_LOG_BYTES);
  log.forEach((t, i) => {
    if (t.rnd.length < RND_USED) throw new Error('turn rnd needs >= 10 bytes');
    const o = i * TURN_LOG_BYTES;
    buf[o] = t.picks[0];
    buf[o + 1] = t.picks[1];
    for (let k = 0; k < RND_USED; k++) buf[o + 2 + k] = t.rnd[k];
    buf[o + 12] = t.mood[0] & 255;
    buf[o + 13] = t.mood[1] & 255;
  });
  return replayBytes(species, buf);
}

/** Same as `replay` with an already-packed log (N x 14 bytes: picks[2] | rnd[10] | mood[2]). */
export function replayBytes(species: [number, number], log: Uint8Array): ReplayResult {
  need();
  return JSON.parse(wasm.replay(Uint8Array.from(species), log));
}

export function previewDamage(state: MatchState, side: Side, slot: Pick, mood: Mood = 0): DamagePreview | null {
  need();
  const r = JSON.parse(wasm.previewDamage(stateToBytes(state), side, slot, mood));
  return r.ok ? { min: r.min, max: r.max, eff: r.eff, acc: r.acc } : null;
}

export function eloUpdate(winner: number, loser: number): [number, number] {
  need();
  const r = wasm.eloUpdate(winner, loser);
  return [r[0], r[1]];
}
