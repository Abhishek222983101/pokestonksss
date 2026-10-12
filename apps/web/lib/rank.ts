export const RANKS = [
  { name: 'Shrimp', min: 0 },
  { name: 'Crab', min: 1050 },
  { name: 'Dolphin', min: 1150 },
  { name: 'Shark', min: 1300 },
  { name: 'Whale', min: 1500 },
] as const;

export function rankOf(rating: number): string {
  let out: string = RANKS[0].name;
  for (const r of RANKS) if (rating >= r.min) out = r.name;
  return out;
}
