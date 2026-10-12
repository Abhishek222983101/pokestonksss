import { create } from 'zustand';
import { isBrokerId } from '../../lib/brokermon';

export type Stage = 'title' | 'select' | 'globe';

const SPECIES_SLOT = 'pokestonksss.broker';
const GUEST_SLOT = 'pokestonksss.guest';

function read(key: string): string | null {
  try { return window.localStorage.getItem(key); } catch { return null; }
}
function write(key: string, v: string) {
  try { window.localStorage.setItem(key, v); } catch { /* storage blocked: lasts this page view only */ }
}

interface SessionState {
  /** Which screen is showing. Not persisted: every visit starts at the title. */
  stage: Stage;
  /** Chosen BrokerMon id ('sol'..'xrp'). Persisted; null until hydrated/chosen. */
  speciesId: string | null;
  /** Guest identity exists on this device (P5 replaces this with the burner keypair + onboarding). */
  guest: boolean;
  /** False during SSR and first paint; flips true once localStorage has been read (in an effect). */
  hydrated: boolean;
  /** Route currently being played (game overlay mounted), or null while on the globe. */
  routeId: string | null;
  setStage: (stage: Stage) => void;
  playAsGuest: () => void;
  signOut: () => void;
  chooseSpecies: (id: string) => void;
  enterRoute: (routeId: string) => void;
  exitRoute: () => void;
  hydrate: () => void;
}

export const useSessionStore = create<SessionState>((set, get) => ({
  stage: 'title',
  speciesId: null,
  guest: false,
  hydrated: false,
  routeId: null,
  setStage: (stage) => set({ stage }),
  playAsGuest: () => { write(GUEST_SLOT, '1'); set({ guest: true }); },
  signOut: () => { write(GUEST_SLOT, '0'); set({ guest: false, routeId: null, stage: 'title' }); },
  chooseSpecies: (id) => {
    if (!isBrokerId(id)) return;
    write(SPECIES_SLOT, id);
    set({ speciesId: id });
  },
  enterRoute: (routeId) => set({ routeId }),
  exitRoute: () => set({ routeId: null }),
  hydrate: () => {
    if (get().hydrated) return;
    const v = read(SPECIES_SLOT);
    set({ speciesId: isBrokerId(v) ? v : null, guest: read(GUEST_SLOT) === '1', hydrated: true });
  },
}));
