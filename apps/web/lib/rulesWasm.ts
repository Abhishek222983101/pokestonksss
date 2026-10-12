/**
 * RulesApi backed by the Rust duel-rules engine (compiled to WASM): the exact same code that runs on-chain.
 * Call `await initRules()` once before anything touches `rules` (RulesGate does this at app start).
 */
import * as w from '@pokestonksss/rules-wasm';
import type { Champion, DamagePreview, FighterState, MatchState, MoveDef, ReplayTurn, RulesApi, Side, Slot, TurnEvent, TurnResult, TypeId } from './rules';

let started: Promise<void> | null = null;
export function initRules(): Promise<void> {
  if (!started) started = w.init();
  return started;
}

const typeId = (name: string) => w.TYPES.indexOf(name as w.TypeName) as TypeId;

let cache: Champion[] | null = null;
function champions(): Champion[] {
  if (cache) return cache;
  cache = w.ROSTER_DATA.champions.map((c) => {
    const moves = c.moves.map((m, i): MoveDef =>
      m.kind === 'strike'
        ? { slot: i as Slot, name: m.name, kind: 'strike', type: typeId((m as { type: string }).type), power: (m as { power: number }).power, acc: (m as { acc: number }).acc }
        : { slot: i as Slot, name: m.name, kind: m.kind as 'guard' | 'charge', type: 0, power: 0, acc: 100 });
    return { id: c.id, name: c.name, asset: c.asset, type: typeId(c.type), hp: c.hp, atk: c.atk, def: c.def, spd: c.spd, moves: moves as Champion['moves'] };
  });
  return cache;
}

const toW = (s: MatchState): w.MatchState => ({
  turn: s.turn, winner: null,
  f: s.fighters.map((f) => ({ species: f.champ, hp: f.hp, maxHp: f.maxHp, charged: f.charged, lastGuard: f.lastGuard, momentum: f.momentum })) as [w.FighterState, w.FighterState],
});
const fromW = (s: w.MatchState): MatchState => ({
  turn: s.turn,
  fighters: s.f.map((f): FighterState => ({ champ: f.species, hp: f.hp, maxHp: f.maxHp, charged: f.charged, lastGuard: f.lastGuard, momentum: f.momentum })) as [FighterState, FighterState],
});

function resolve(state: MatchState, picks: [Slot, Slot], rnd: Uint8Array, mood: [number, number]): TurnResult {
  const r = w.resolveTurn(toW(state), picks, rnd, mood as [number, number]);
  const hp: [number, number] = [state.fighters[0].hp, state.fighters[1].hp];
  const events: TurnEvent[] = [];
  for (const e of r.events) {
    switch (e.t) {
      case 'mood': events.push({ kind: 'mood', side: e.side, mood: e.mood }); break;
      case 'guard': hp[e.side] = Math.min(state.fighters[e.side].maxHp, hp[e.side] + e.heal); events.push({ kind: 'guard', side: e.side, heal: e.heal, hp: [hp[0], hp[1]] }); break;
      case 'charge': events.push({ kind: 'charge', side: e.side, hp: [hp[0], hp[1]] }); break;
      case 'miss': events.push({ kind: 'miss', side: e.side, slot: picks[e.side], hp: [hp[0], hp[1]] }); break;
      case 'hit': { const t = (1 - e.side) as Side; hp[t] = Math.max(0, hp[t] - e.dmg); events.push({ kind: 'hit', side: e.side, slot: picks[e.side], dmg: e.dmg, crit: e.crit, eff: e.eff, hp: [hp[0], hp[1]] }); break; }
      case 'ko': events.push({ kind: 'ko', side: e.side }); break;
      case 'end': break;
    }
  }
  return { state: fromW(r.state), events, winner: r.state.winner };
}

export const rules: RulesApi = {
  roster: champions,
  newMatch: (a, b) => fromW(w.newMatch(a, b)),
  resolveTurn: resolve,
  botPick: (state, side, rnd) => w.botPick(toW(state), side, rnd, w.TIER.PRO) as Slot,
  previewDamage: (state, side, slot): DamagePreview => {
    const p = w.previewDamage(toW(state), side, slot, 0);
    return p ? { min: p.min, max: p.max, eff: p.eff } : { min: 0, max: 0, eff: 100 };
  },
  replay: (a: number, b: number, turns: ReplayTurn[]): TurnResult => {
    let state = rules.newMatch(a, b);
    let last: TurnResult = { state, events: [], winner: null };
    for (const t of turns) { last = resolve(state, t.picks, t.rnd, t.mood); state = last.state; }
    return last;
  },
  elo: (rating, opp, won) => (won ? w.eloUpdate(rating, opp)[0] : w.eloUpdate(opp, rating)[1]),
};
