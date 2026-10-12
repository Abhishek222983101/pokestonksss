export const PHASE = { IDLE: 0, WAITING: 1, PICKING: 2, REVEALING: 3, ROLLING: 4, FINISHED: 5 } as const;
export const MODE = { PRACTICE: 0, DUEL: 1 } as const;
export const NO_WINNER = 255;

export interface Side { species: number; hp: number; maxHp: number; charged: boolean; lastGuard: boolean; momentum: number }
export interface MatchView { turn: number; winner: number; sides: [Side, Side] }

/** Decodes duel_rules::MatchState bytes (16 B): turn, winner, then per side species, hp(2), maxhp(2), charged, last_guard. */
export function decodeMatch(b: ArrayLike<number>): MatchView {
  const u = Uint8Array.from(b as ArrayLike<number>);
  const dv = new DataView(u.buffer, u.byteOffset, u.byteLength);
  const side = (i: number): Side => {
    const o = 2 + i * 7;
    return { species: u[o], hp: dv.getUint16(o + 1, true), maxHp: dv.getUint16(o + 3, true), charged: u[o + 5] === 1, lastGuard: (u[o + 6] & 1) === 1, momentum: (u[o + 6] >> 1) & 3 };
  };
  return { turn: u[0], winner: u[1], sides: [side(0), side(1)] };
}

export interface TurnLogEntry { picks: [number, number]; rnd: number[]; mood: [number, number] }
/** Decodes the stored per-turn log (14 B each: picks[2], rnd[10], mood[2] as i8). */
export function decodeLog(log: ArrayLike<ArrayLike<number>>, len: number): TurnLogEntry[] {
  const i8 = (x: number) => (x > 127 ? x - 256 : x);
  const out: TurnLogEntry[] = [];
  for (let i = 0; i < len; i++) {
    const b = Array.from(log[i]);
    out.push({ picks: [b[0], b[1]], rnd: b.slice(2, 12), mood: [i8(b[12]), i8(b[13])] });
  }
  return out;
}

export interface ArenaView {
  host: string; guest: string; mode: number; phase: number; tier: number;
  match: MatchView; picks: [number, number]; committedMask: number; revealedMask: number;
  vrfPending: boolean; deadline: number; updatedAt: number; snap: [bigint, bigint];
  winner: number; log: TurnLogEntry[];
}
export interface TrainerView {
  owner: string; rating: number; wins: number; losses: number; streak: number; dex: number; battles: number; unsaved: number; commits: number; nameSeed: number;
}

/** Rating tier names (crypto wallet-size taxonomy). */
export function tierName(rating: number): string {
  if (rating >= 1400) return "Whale";
  if (rating >= 1200) return "Shark";
  if (rating >= 1050) return "Dolphin";
  if (rating >= 900) return "Crab";
  return "Shrimp";
}

export const TIERS: Array<[string, number]> = [['Shrimp', 0], ['Crab', 900], ['Dolphin', 1050], ['Shark', 1200], ['Whale', 1400]];
/** Next rating tier and how far along you are (0..1). */
export function tierProgress(rating: number): { name: string; next: string | null; pct: number } {
  let i = 0;
  for (let k = 0; k < TIERS.length; k++) if (rating >= TIERS[k][1]) i = k;
  const next = TIERS[i + 1];
  return { name: TIERS[i][0], next: next ? next[0] : null, pct: next ? (rating - TIERS[i][1]) / (next[1] - TIERS[i][1]) : 1 };
}
export const handleOf = (owner: string, tier: string) => `${tier}-${owner.slice(0, 4)}`;
