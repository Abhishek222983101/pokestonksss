/**
 * TEMPORARY TypeScript implementation of docs/RULES.md (integer math, deterministic).
 * Replaced by packages/rules-wasm; keep every export shaped like `RulesApi` in ./rules.ts.
 */
import type {
  Champion, DamagePreview, FighterState, MatchState, Mood, MoveDef, ReplayTurn, RulesApi, Side, Slot, TurnEvent, TurnResult, TypeId,
} from './rules';
const MAX_TURNS = 16;

const mv = (slot: Slot, name: string, type: TypeId, power: number, acc: number): MoveDef => ({ slot, name, kind: 'strike', type, power, acc });
const hedge = (): MoveDef => ({ slot: 2, name: 'Hedge', kind: 'guard', type: 0, power: 0, acc: 100 });
const lever = (): MoveDef => ({ slot: 3, name: 'Leverage', kind: 'charge', type: 0, power: 0, acc: 100 });

// Types: 0 SPEED 1 ARMOR 2 ARCANE 3 TIDE 4 SHADE
const ROSTER: Champion[] = [
  { id: 0, name: 'Solarc', asset: 'SOL', type: 0, hp: 225, atk: 94, def: 68, spd: 112, moves: [mv(0, 'Parallel Rush', 0, 62, 95), mv(1, 'Hash Burst', 2, 55, 100), hedge(), lever()] },
  { id: 1, name: 'Bitrock', asset: 'BTC', type: 1, hp: 267, atk: 72, def: 80, spd: 62, moves: [mv(0, 'Halving Slam', 1, 64, 92), mv(1, 'Cold Wallet', 4, 55, 100), hedge(), lever()] },
  { id: 2, name: 'Etherion', asset: 'ETH', type: 2, hp: 237, atk: 90, def: 74, spd: 84, moves: [mv(0, 'Gas Storm', 2, 62, 95), mv(1, 'Merge Wave', 3, 55, 100), hedge(), lever()] },
  { id: 3, name: 'Suiflow', asset: 'SUI', type: 3, hp: 228, atk: 90, def: 72, spd: 96, moves: [mv(0, 'Move Tide', 3, 60, 96), mv(1, 'Object Dash', 0, 56, 100), hedge(), lever()] },
  { id: 4, name: 'Zecshade', asset: 'ZEC', type: 4, hp: 231, atk: 88, def: 70, spd: 88, moves: [mv(0, 'Shielded Strike', 4, 62, 94), mv(1, 'Zero Proof', 1, 55, 100), hedge(), lever()] },
  { id: 5, name: 'Bnbull', asset: 'BNB', type: 1, hp: 255, atk: 80, def: 90, spd: 66, moves: [mv(0, 'Burn Charge', 1, 62, 94), mv(1, 'Chain Surge', 3, 56, 100), hedge(), lever()] },
  { id: 6, name: 'Dogeon', asset: 'DOGE', type: 0, hp: 240, atk: 92, def: 66, spd: 100, moves: [mv(0, 'Much Wow', 0, 60, 96), mv(1, 'To The Moon', 4, 56, 100), hedge(), lever()] },
  { id: 7, name: 'Ripplet', asset: 'XRP', type: 3, hp: 246, atk: 76, def: 82, spd: 78, moves: [mv(0, 'Ledger Wave', 3, 60, 96), mv(1, 'Escrow Wall', 2, 56, 100), hedge(), lever()] },
];

const fighter = (champ: number): FighterState => {
  const c = ROSTER[champ] ?? ROSTER[0];
  return { champ: c.id, hp: c.hp, maxHp: c.hp, charged: false, lastGuard: false };
};

function eff(att: TypeId, def: TypeId): 50 | 100 | 200 {
  const d = (def - att + 5) % 5;
  return d === 0 ? 100 : d === 1 || d === 2 ? 200 : 50;
}

const pct = (v: number, p: number) => Math.floor((v * p) / 100);

interface DmgCtx { rndVar: number; crit: boolean; mood: Mood; targetPick: Slot; targetLastGuard: boolean }

function damage(att: Champion, def: Champion, m: MoveDef, charged: boolean, c: DmgCtx): number {
  let d = Math.floor(Math.floor((22 * m.power * att.atk) / def.def) / 50) + 2;
  d = pct(d, m.type === att.type ? 125 : 100);
  d = pct(d, eff(m.type, def.type));
  d = pct(d, 85 + (c.rndVar % 16));
  d = pct(d, c.crit ? 150 : 100);
  d = pct(d, c.mood > 0 ? 110 : c.mood < 0 ? 90 : 100);
  d = pct(d, charged ? 200 : 100);
  if (c.targetPick === 2) d = pct(d, c.targetLastGuard ? 50 : 20);
  if (c.targetPick === 3) d = pct(d, 130);
  return Math.max(d, 1);
}

function resolveTurn(state: MatchState, picks: [Slot, Slot], rnd: Uint8Array, mood: [Mood, Mood]): TurnResult {
  const f: [FighterState, FighterState] = [{ ...state.fighters[0] }, { ...state.fighters[1] }];
  const ch = [ROSTER[f[0].champ], ROSTER[f[1].champ]] as const;
  const mv4 = [ch[0].moves[picks[0]], ch[1].moves[picks[1]]] as const;
  const events: TurnEvent[] = [];
  const hp = (): [number, number] => [f[0].hp, f[1].hp];
  const prevGuard: [boolean, boolean] = [f[0].lastGuard, f[1].lastGuard];

  for (const s of [0, 1] as const) if (mood[s] !== 0) events.push({ kind: 'mood', side: s, mood: mood[s] });

  // 1. guard heals, charge flags
  for (const s of [0, 1] as const) {
    if (mv4[s].kind === 'guard') {
      const heal = prevGuard[s] ? 0 : Math.min(f[s].maxHp - f[s].hp, Math.floor(f[s].maxHp / 10));
      f[s].hp += heal;
      events.push({ kind: 'guard', side: s, heal, hp: hp() });
    } else if (mv4[s].kind === 'charge') {
      f[s].charged = true;
      events.push({ kind: 'charge', side: s, hp: hp() });
    }
  }

  // 2. strikes by speed
  const first: Side = ch[0].spd === ch[1].spd ? ((rnd[6] & 1) as Side) : ch[0].spd > ch[1].spd ? 0 : 1;
  let koSide: Side | null = null;
  for (const s of [first, (1 - first) as Side]) {
    if (koSide !== null) break;
    const m = mv4[s];
    if (m.kind !== 'strike') continue;
    const t = (1 - s) as Side;
    const hit = rnd[s] % 100 < m.acc;
    const wasCharged = f[s].charged;
    f[s].charged = false;
    if (!hit) { events.push({ kind: 'miss', side: s, slot: m.slot, hp: hp() }); continue; }
    const dmg = damage(ch[s], ch[t], m, wasCharged, {
      rndVar: rnd[4 + s], crit: rnd[2 + s] < 16, mood: mood[s], targetPick: picks[t], targetLastGuard: prevGuard[t],
    });
    f[t].hp = Math.max(0, f[t].hp - dmg);
    events.push({ kind: 'hit', side: s, slot: m.slot, dmg, crit: rnd[2 + s] < 16, eff: eff(m.type, ch[t].type), hp: hp() });
    if (f[t].hp === 0) { events.push({ kind: 'ko', side: t }); koSide = t; }
  }

  for (const s of [0, 1] as const) f[s].lastGuard = mv4[s].kind === 'guard';

  const turn = state.turn + 1;
  let winner: Side | null = null;
  if (koSide !== null) winner = (1 - koSide) as Side;
  else if (turn >= MAX_TURNS) {
    const r0 = Math.floor((f[0].hp * 1000) / f[0].maxHp), r1 = Math.floor((f[1].hp * 1000) / f[1].maxHp);
    winner = r0 === r1 ? ((rnd[7] & 1) as Side) : r0 > r1 ? 0 : 1;
  }
  return { state: { turn, fighters: f }, events, winner };
}

function expected(c: Champion, side: FighterState, tgt: Champion, m: MoveDef): number {
  const d = Math.floor(Math.floor((22 * m.power * c.atk) / tgt.def) / 50) + 2;
  let v = pct(d, m.type === c.type ? 125 : 100);
  v = pct(v, eff(m.type, tgt.type));
  void side;
  return (v * m.acc) / 100;
}

function botPick(state: MatchState, side: Side, rnd: Uint8Array): Slot {
  const me = state.fighters[side], foe = state.fighters[(1 - side) as Side];
  if (rnd[8] < 64) return (rnd[9] % 4) as Slot;
  const c = ROSTER[me.champ], t = ROSTER[foe.champ];
  const myPct = (me.hp * 100) / me.maxHp;
  let best: Slot = 0, bestScore = -1;
  for (const m of c.moves) {
    let score = 0;
    if (m.kind === 'strike') score = expected(c, me, t, m);
    else if (m.kind === 'guard') score = (myPct < 40 ? 30 : 8) + (foe.charged ? 25 : 0) - (me.lastGuard ? 20 : 0);
    else score = myPct > 60 && foe.lastGuard ? 38 : myPct > 60 ? 14 : 2;
    if (score > bestScore) { bestScore = score; best = m.slot; }
  }
  return best;
}

function previewDamage(state: MatchState, side: Side, slot: Slot): DamagePreview {
  const a = ROSTER[state.fighters[side].champ], t = ROSTER[state.fighters[(1 - side) as Side].champ];
  const m = a.moves[slot];
  if (m.kind !== 'strike') return { min: 0, max: 0, eff: 100 };
  const base = (variance: number, crit: boolean) => damage(a, t, m, state.fighters[side].charged, {
    rndVar: variance, crit, mood: 0, targetPick: 0, targetLastGuard: false,
  });
  return { min: base(0, false), max: base(15, false), eff: eff(m.type, t.type) };
}

function replay(a: number, b: number, turns: ReplayTurn[]): TurnResult {
  let state = newMatch(a, b);
  let last: TurnResult = { state, events: [], winner: null };
  for (const t of turns) {
    last = resolveTurn(state, t.picks, t.rnd, t.mood);
    state = last.state;
    if (last.winner !== null) break;
  }
  return last;
}

function newMatch(a: number, b: number): MatchState {
  return { turn: 0, fighters: [fighter(a), fighter(b)] };
}

function elo(rating: number, opponent: number, won: boolean): number {
  const K = 24;
  const diff = Math.max(-400, Math.min(400, opponent - rating));
  // integer-ish logistic: 1/(1+10^(diff/400)) in permille via a small lookup-free approximation, then floor division
  const e = Math.round(1000 / (1 + Math.pow(10, diff / 400)));
  return rating + Math.floor((K * ((won ? 1000 : 0) - e)) / 1000);
}

export const rules: RulesApi = {
  roster: () => ROSTER,
  newMatch, resolveTurn, botPick, previewDamage, replay, elo,
};
