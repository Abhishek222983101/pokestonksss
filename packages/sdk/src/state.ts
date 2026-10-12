export const PHASE = { IDLE: 0, WAITING: 1, PICKING: 2, REVEALING: 3, ROLLING: 4, FINISHED: 5 } as const;
export const MODE = { PRACTICE: 0, DUEL: 1 } as const;
export const NO_WINNER = 255;

export interface Side { species: number; hp: number; maxHp: number; charged: boolean; lastGuard: boolean; momentum: number; level: number }
export interface MatchView { turn: number; winner: number; sides: [Side, Side] }

/** Decodes duel_rules::MatchState bytes (16 B): turn, winner, then per side species, hp(2), maxhp(2), charged, last_guard. */
export function decodeMatch(b: ArrayLike<number>): MatchView {
  const u = Uint8Array.from(b as ArrayLike<number>);
  const dv = new DataView(u.buffer, u.byteOffset, u.byteLength);
  const side = (i: number): Side => {
    const o = 2 + i * 7;
    return { species: u[o], hp: dv.getUint16(o + 1, true), maxHp: dv.getUint16(o + 3, true), charged: u[o + 5] === 1, lastGuard: (u[o + 6] & 1) === 1, momentum: (u[o + 6] >> 1) & 3, level: u[o + 6] >> 3 };
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
  /** XP per species (index = species id). */
  xp: number[]; avatar: number;
}

// ---- levels and evolutions (mirror of duel_rules::{LEVEL_XP, level_for_xp}; a wasm test pins them together)
export const MAX_LEVEL = 9;
export const LEVEL_XP = [0, 30, 70, 120, 180, 250, 330, 420, 520, 630];
export function levelForXp(xp: number): number {
  let l = 0;
  while (l < LEVEL_XP.length - 1 && xp >= LEVEL_XP[l + 1]) l++;
  return l;
}
/** Evolution stage: 0 base, 1 from level 3, 2 from level 6. */
export const evolutionStage = (level: number): 0 | 1 | 2 => (level >= 6 ? 2 : level >= 3 ? 1 : 0);
/** Progress inside the current level (0..1) and XP still needed for the next one. */
export function levelProgress(xp: number): { level: number; pct: number; toNext: number | null } {
  const level = levelForXp(xp);
  if (level >= MAX_LEVEL) return { level, pct: 1, toNext: null };
  const lo = LEVEL_XP[level], hi = LEVEL_XP[level + 1];
  return { level, pct: (xp - lo) / (hi - lo), toNext: hi - xp };
}

// ---- badges (mirror of the program's `badge_earned`)
export interface BadgeInfo { id: number; name: string; how: string; rarity: "common" | "rare" | "epic" }
export const BADGES: BadgeInfo[] = [
  { id: 0, name: "First Blood", how: "Win your first battle", rarity: "common" },
  { id: 1, name: "Regular", how: "Win 5 battles", rarity: "common" },
  { id: 2, name: "Collector", how: "Defeat 4 different BrokerMons", rarity: "common" },
  { id: 3, name: "Dolphin", how: "Reach 1050 rating", rarity: "rare" },
  { id: 4, name: "Shark", how: "Reach 1200 rating", rarity: "epic" },
  { id: 5, name: "Evolved", how: "Evolve a BrokerMon (level 3)", rarity: "rare" },
  { id: 6, name: "Apex", how: "Evolve a BrokerMon again (level 6)", rarity: "epic" },
  { id: 7, name: "Hot Streak", how: "Hold a 3 win streak", rarity: "rare" },
];
const popcount = (x: number) => { let n = 0; for (let v = x; v; v &= v - 1) n++; return n; };
/** Which badges this Trainer record qualifies for right now. */
export function badgesEarned(t: Pick<TrainerView, "wins" | "dex" | "rating" | "streak" | "xp">): boolean[] {
  const top = Math.max(0, ...t.xp.map(levelForXp));
  return [t.wins >= 1, t.wins >= 5, popcount(t.dex) >= 4, t.rating >= 1050, t.rating >= 1200, top >= 3, top >= 6, t.streak >= 3];
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
