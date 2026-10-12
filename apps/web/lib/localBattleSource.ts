import type { BattleResult, BattleSnapshot, BattleSource, TurnRecord } from './battleSource';
import { loadProfile, saveProfile } from './profile';
import { rules, type Mood, type Slot } from './rules';
import { getPrice } from './market';
import { brokerByNum } from './brokermon';

const TURN_MS = 30_000;

function randomBytes32(): Uint8Array {
  const b = new Uint8Array(32);
  if (typeof crypto !== 'undefined') crypto.getRandomValues(b);
  else for (let i = 0; i < 32; i++) b[i] = Math.floor(Math.random() * 256);
  return b;
}

/** Offline battle against the House Agent. Instant: no network, no queue. */
export class LocalBattleSource implements BattleSource {
  private snap: BattleSnapshot;
  private subs = new Set<(s: BattleSnapshot) => void>();
  private bell: [number, number];
  private ended = false;
  private houseRating = 1000;

  constructor(playerChamp: number, foeChamp: number) {
    const roster = rules.roster();
    const a = brokerByNum(playerChamp).id, b = brokerByNum(foeChamp).id;
    this.bell = [getPrice(a).price, getPrice(b).price];
    this.snap = {
      phase: 'PICKING',
      champions: [roster[playerChamp], roster[foeChamp]],
      opponent: { label: 'House Agent', isBot: true },
      state: rules.newMatch(playerChamp, foeChamp),
      mood: [0, 0], movePct: [0, 0], locked: false, turns: [], result: null, turnMs: TURN_MS,
    };
    this.refreshMood();
  }

  getSnapshot() { return this.snap; }

  subscribe(cb: (s: BattleSnapshot) => void) {
    this.subs.add(cb);
    return () => { this.subs.delete(cb); };
  }

  private emit(patch: Partial<BattleSnapshot>) {
    this.snap = { ...this.snap, ...patch };
    this.subs.forEach((s) => s(this.snap));
  }

  /** Price now vs the bell: +-0.1% flips the mood (the simulated feed moves ~0.2% per tick). */
  private refreshMood() {
    const ids = [brokerByNum(this.snap.state.fighters[0].champ).id, brokerByNum(this.snap.state.fighters[1].champ).id];
    const move = ids.map((id, i) => ((getPrice(id).price - this.bell[i]) / this.bell[i]) * 100) as [number, number];
    const mood = move.map((m) => (m > 0.1 ? 1 : m < -0.1 ? -1 : 0)) as [Mood, Mood];
    this.snap = { ...this.snap, mood, movePct: move };
  }

  async lock(slot: Slot): Promise<void> {
    const s = this.snap;
    if (s.phase !== 'PICKING' || s.locked || this.ended) return;
    this.emit({ locked: true, phase: 'RESOLVING' });
    const rnd = randomBytes32();
    // The House Agent decides from public state only (never reads `slot`).
    const bot = rules.botPick(s.state, 1, rnd);
    this.refreshMood();
    const res = rules.resolveTurn(s.state, [slot, bot], rnd, this.snap.mood);
    const rec: TurnRecord = { turn: res.state.turn, picks: [slot, bot], events: res.events, state: res.state };
    const turns = [...s.turns, rec];
    if (res.winner === null) {
      this.emit({ state: res.state, turns, locked: false, phase: 'PICKING' });
      return;
    }
    this.ended = true;
    const prof = loadProfile();
    const won = res.winner === 0;
    const after = rules.elo(prof.rating, this.houseRating, won);
    saveProfile({ rating: after, wins: prof.wins + (won ? 1 : 0), losses: prof.losses + (won ? 0 : 1) });
    const result: BattleResult = { winner: res.winner, turns: res.state.turn, ratingBefore: prof.rating, ratingAfter: after };
    this.emit({ state: res.state, turns, locked: true, phase: 'FINISHED', result });
  }

  async leave(): Promise<void> {
    if (this.ended) return;
    this.ended = true;
    const prof = loadProfile();
    const after = rules.elo(prof.rating, this.houseRating, false);
    saveProfile({ rating: after, wins: prof.wins, losses: prof.losses + 1 });
    this.emit({
      phase: 'FINISHED', locked: true,
      result: { winner: 1, turns: this.snap.state.turn, ratingBefore: prof.rating, ratingAfter: after },
    });
  }
}
