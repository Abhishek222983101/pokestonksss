/** Local (offline) trainer profile: rating + record, kept in localStorage. P7 replaces this with the on-chain Trainer. */
const KEY = 'pokestonksss.profile.v1';

export interface Profile { rating: number; wins: number; losses: number }

export function loadProfile(): Profile {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<Profile>;
      if (typeof p.rating === 'number') return { rating: p.rating, wins: p.wins ?? 0, losses: p.losses ?? 0 };
    }
  } catch { /* storage blocked */ }
  return { rating: 1000, wins: 0, losses: 0 };
}

export function saveProfile(p: Profile) {
  try { window.localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* storage blocked */ }
}
