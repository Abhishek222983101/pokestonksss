/* tslint:disable */
/* eslint-disable */

/**
 * House Agent creature level for a tier and the player's level.
 */
export function botLevel(tier: number, player_level: number): number;

/**
 * House Agent pick (0..=3), or -1 on bad input. `tier`: 0 Rookie, 1 Pro, 2 Champion, 3 Trainee, 4 Dummy.
 */
export function botPick(state: Uint8Array, side: number, rnd: Uint8Array, tier: number): number;

/**
 * `[newWinnerRating, newLoserRating]`.
 */
export function eloUpdate(winner: number, loser: number): Int32Array;

/**
 * Creature level for accumulated XP.
 */
export function levelForXp(xp: number): number;

/**
 * New match state JSON `{turn,winner,f:[..]}`; `{"ok":false,...}` if a species is invalid.
 */
export function newMatch(a: number, b: number, la: number, lb: number): string;

/**
 * `{"ok":true,"min":..,"max":..,"eff":..,"acc":..}` for `side`'s strike `slot` vs the opponent (no guard/charge on
 * the defender); `mood` is -1/0/1 for the attacker.
 */
export function previewDamage(state: Uint8Array, side: number, slot: number, mood: number): string;

/**
 * `species`: 2 bytes; `levels`: 2 bytes; `log`: N * 14 bytes (picks[2] | rnd[10] | mood[2]).
 * Returns `{"ok":true,"winner":..,"hp":[..],"turns":..}` or `{"ok":false,"error":code}`.
 */
export function replay(species: Uint8Array, levels: Uint8Array, log: Uint8Array): string;

/**
 * `state`: 16 bytes (see MatchState::to_bytes), `picks`: 2 bytes, `rnd`: 32 bytes (only [0..10] used),
 * `mood`: 2 bytes (i8 as u8). Returns `{"ok":true,"state":{..},"events":[..]}` or `{"ok":false,"error":..}`.
 */
export function resolveTurn(state: Uint8Array, picks: Uint8Array, rnd: Uint8Array, mood: Uint8Array): string;

/**
 * Roster definition (`rules/roster.json`) as JSON text.
 */
export function roster(): string;

/**
 * XP for a finished match.
 */
export function xpGain(won: boolean, my_rating: number, opp_rating: number): number;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly botLevel: (a: number, b: number) => number;
    readonly botPick: (a: number, b: number, c: number, d: number, e: number, f: number) => number;
    readonly eloUpdate: (a: number, b: number, c: number) => void;
    readonly levelForXp: (a: number) => number;
    readonly newMatch: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly previewDamage: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly replay: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => void;
    readonly resolveTurn: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number) => void;
    readonly roster: (a: number) => void;
    readonly xpGain: (a: number, b: number, c: number) => number;
    readonly __wbindgen_export: (a: number, b: number) => number;
    readonly __wbindgen_add_to_stack_pointer: (a: number) => number;
    readonly __wbindgen_export2: (a: number, b: number, c: number) => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
