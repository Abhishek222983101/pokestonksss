import { PublicKey } from '@solana/web3.js';
import { GameClient, PHASE, arenaPda, type ArenaView } from '@pokestonksss/sdk';
import type { BattleResult, BattleSnapshot, BattleSource, TurnRecord } from '../battleSource';
import { rules, type MatchState, type Mood, type Side, type Slot, type TurnEvent } from '../rules';
import { getClient } from './config';
import { guestKeypair, guestSigner } from './guest';
import { moodOf, watchPrice } from './oracle';
import { useProof } from './proof';
import { friendly, useChain } from './store';

const TURN_MS = 30_000;
const flip = (s: Side): Side => (s === 0 ? 1 : 0);
const hex = (a: ArrayLike<number>) => Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
const sealKey = (arena: string, turn: number) => `pokestonksss.seal.${arena}.${turn}`;

function swapEvent(e: TurnEvent): TurnEvent {
  const hp = (h: [number, number]): [number, number] => [h[1], h[0]];
  switch (e.kind) {
    case 'mood': return { ...e, side: flip(e.side) };
    case 'ko': return { ...e, side: flip(e.side) };
    case 'guard': case 'charge': return { ...e, side: flip(e.side), hp: hp(e.hp) };
    case 'miss': return { ...e, side: flip(e.side), hp: hp(e.hp) };
    case 'hit': return { ...e, side: flip(e.side), hp: hp(e.hp) };
  }
}

export type DuelRole = 'host' | 'guest';

/**
 * Sealed commit-reveal duel on the Ephemeral Rollup. Side 0 is always the local player: for the guest the
 * on-chain orientation (host = side 0) is mirrored before it reaches the scene.
 */
export class ChainDuelSource implements BattleSource {
  private subs = new Set<(s: BattleSnapshot) => void>();
  private snap: BattleSnapshot;
  private arena: ArenaView | null = null;
  private stops: Array<() => void> = [];
  private nowRaw: [bigint | null, bigint | null] = [null, null];
  private ended = false;
  private busy = false;
  private ratingBefore = 1000;
  private hostKey: PublicKey;
  private opponentName: string;
  private timeoutTimer: ReturnType<typeof setInterval> | null = null;
  integrityOk = true;

  /** `hostSpecies` / `guestSpecies` are on-chain orientation; the snapshot mirrors them for the guest. */
  constructor(private role: DuelRole, host: PublicKey, private hostSpecies: number, private guestSpecies: number, opponent: PublicKey) {
    this.hostKey = host;
    const me = role === 'host' ? hostSpecies : guestSpecies;
    const foe = role === 'host' ? guestSpecies : hostSpecies;
    const roster = rules.roster();
    this.opponentName = `Friend ${opponent.toBase58().slice(0, 4)}…`;
    this.snap = {
      onChain: true, phase: 'RESOLVING', champions: [roster[me], roster[foe]], opponent: { label: this.opponentName, isBot: false },
      state: rules.newMatch(me, foe), mood: [0, 0], movePct: [0, 0], locked: true, turns: [], result: null, turnMs: TURN_MS,
    };
  }

  /** Begin watching the shared arena (call after the duel is joined). */
  async attach() {
    const client = getClient();
    useProof.getState().reset();
    const t = await client.getTrainer(guestKeypair().publicKey);
    if (t) this.ratingBefore = t.rating;
    this.stops.push(client.watchArena(this.hostKey, (a) => this.onArena(a)));
    const myIdx = this.role === 'host' ? 0 : 1;
    this.stops.push(watchPrice(client.er, this.mySpecies(), (p) => { this.nowRaw[myIdx] = p.raw; this.refreshMood(); }));
    this.stops.push(watchPrice(client.er, this.theirSpecies(), (p) => { this.nowRaw[1 - myIdx] = p.raw; this.refreshMood(); }));
    const a = await client.getArena(this.hostKey);
    if (a) this.onArena(a);
    this.timeoutTimer = setInterval(() => void this.maybeClaimTimeout(), 2500);
  }

  private mySpecies() { return this.role === 'host' ? this.hostSpecies : this.guestSpecies; }
  private theirSpecies() { return this.role === 'host' ? this.guestSpecies : this.hostSpecies; }
  private seat() { return this.role === 'host' ? 0 : 1; }

  getSnapshot() { return this.snap; }
  subscribe(cb: (s: BattleSnapshot) => void) { this.subs.add(cb); return () => { this.subs.delete(cb); }; }
  private emit(p: Partial<BattleSnapshot>) { this.snap = { ...this.snap, ...p }; this.subs.forEach((f) => f(this.snap)); }

  private refreshMood() {
    const a = this.arena;
    if (!a) return;
    const my = this.seat();
    const mood: [Mood, Mood] = [moodOf(a.snap[my], this.nowRaw[my]), moodOf(a.snap[1 - my], this.nowRaw[1 - my])];
    const pct = (i: number): number => (a.snap[i] > 0n && this.nowRaw[i] ? Number(((this.nowRaw[i]! - a.snap[i]) * 100000n) / a.snap[i]) / 1000 : 0);
    useProof.getState().set({ weighed: { snap: [a.snap[0].toString(), a.snap[1].toString()], now: [String(this.nowRaw[0] ?? 0), String(this.nowRaw[1] ?? 0)], mood } });
    this.emit({ mood, movePct: [pct(my), pct(1 - my)] });
  }

  private replay(a: ArenaView): { turns: TurnRecord[]; state: MatchState } {
    let state = rules.newMatch(this.hostSpecies, this.guestSpecies);
    const turns: TurnRecord[] = [];
    const guest = this.role === 'guest';
    for (const e of a.log) {
      const rnd = new Uint8Array(32); rnd.set(e.rnd);
      const res = rules.resolveTurn(state, e.picks as [Slot, Slot], rnd, e.mood as [Mood, Mood]);
      state = res.state;
      const picks = (guest ? [e.picks[1], e.picks[0]] : e.picks) as [Slot, Slot];
      turns.push({ turn: res.state.turn, picks, events: guest ? res.events.map(swapEvent) : res.events, state: guest ? this.mirror(res.state) : res.state });
    }
    return { turns, state };
  }

  private mirror(s: MatchState): MatchState { return { turn: s.turn, fighters: [s.fighters[1], s.fighters[0]] }; }

  private onArena(a: ArenaView) {
    this.arena = a;
    const { turns, state } = this.replay(a);
    const f = a.match.sides;
    this.integrityOk = state.turn === a.match.turn && state.fighters[0].hp === f[0].hp && state.fighters[1].hp === f[1].hp;
    const proof = useProof.getState();
    if (proof.rolled.length < a.log.length) {
      const have = proof.rolled.length;
      proof.set({ rolled: [...proof.rolled, ...a.log.slice(have).map((e, i) => ({ label: `turn ${have + i + 1} VRF roll`, sig: '', link: '', rnd: hex(e.rnd) }))] });
    }
    const onChain: MatchState = {
      turn: a.match.turn,
      fighters: [
        { champ: this.hostSpecies, hp: f[0].hp, maxHp: f[0].maxHp, charged: f[0].charged, lastGuard: f[0].lastGuard },
        { champ: this.guestSpecies, hp: f[1].hp, maxHp: f[1].maxHp, charged: f[1].charged, lastGuard: f[1].lastGuard },
      ],
    };
    const finished = a.phase === PHASE.FINISHED;
    const my = this.seat();
    const iCommitted = (a.committedMask & (1 << my)) !== 0;
    const waiting = a.phase === PHASE.WAITING;
    const locked = finished || a.phase === PHASE.ROLLING || a.phase === PHASE.REVEALING || waiting || (a.phase === PHASE.PICKING && iCommitted);
    this.emit({
      state: this.role === 'guest' ? this.mirror(onChain) : onChain,
      turns,
      phase: finished ? 'FINISHED' : locked ? 'RESOLVING' : 'PICKING',
      locked,
    });
    this.refreshMood();
    if (a.phase === PHASE.REVEALING) void this.autoReveal(a);
    if (finished && !this.ended) void this.finish(a);
  }

  async lock(slot: Slot): Promise<void> {
    const a = this.arena;
    if (!a || a.phase !== PHASE.PICKING || this.ended || this.busy) return;
    this.busy = true;
    const client = getClient(); const signer = guestSigner();
    const salt = crypto.getRandomValues(new Uint8Array(32));
    const turn = a.match.turn;
    try { window.localStorage.setItem(sealKey(this.hostKey.toBase58(), turn), JSON.stringify({ slot, salt: Array.from(salt) })); } catch { /* memory only */ }
    this.emit({ locked: true, phase: 'RESOLVING' });
    try {
      const hash = GameClient.commitment(slot, salt, arenaPda(this.hostKey), turn, signer.publicKey);
      const r = await client.commitPick(signer, this.hostKey, hash);
      useProof.getState().addSealed({ label: `sealed pick turn ${turn + 1}`, sig: r.sig, link: r.link, ms: r.ms });
    } catch (e) {
      this.emit({ locked: false, phase: 'PICKING' });
      throw new Error(friendly(e));
    } finally { this.busy = false; }
  }

  private revealing = false;
  private async autoReveal(a: ArenaView) {
    const my = this.seat();
    if (this.revealing || (a.revealedMask & (1 << my)) !== 0) return;
    let saved: { slot: number; salt: number[] } | null = null;
    try { saved = JSON.parse(window.localStorage.getItem(sealKey(this.hostKey.toBase58(), a.match.turn)) ?? 'null'); } catch { /* none */ }
    if (!saved) return;
    this.revealing = true;
    try {
      const r = await getClient().revealPick(guestSigner(), this.hostKey, saved.slot, Uint8Array.from(saved.salt));
      useProof.getState().addRolled({ label: `reveal turn ${a.match.turn + 1}`, sig: r.sig, link: r.link, ms: r.ms });
    } catch { /* the other side's reveal may have won the race; state will update */ }
    finally { this.revealing = false; }
  }

  /** Anyone may call claim_timeout once the 30 s deadline passed (missing steps default to GUARD; two misses forfeit). */
  private async maybeClaimTimeout() {
    const a = this.arena;
    if (!a || this.ended || (a.phase !== PHASE.PICKING && a.phase !== PHASE.REVEALING)) return;
    if (a.deadline > 0 && Date.now() / 1000 > a.deadline + 2) {
      try { await getClient().claimTimeout(guestSigner(), this.hostKey, new PublicKey(a.guest)); } catch { /* already handled */ }
    }
  }

  private async finish(a: ArenaView) {
    this.ended = true;
    if (this.timeoutTimer) clearInterval(this.timeoutTimer);
    let after = this.ratingBefore;
    for (let i = 0; i < 6; i++) {
      const t = await useChain.getState().refreshTrainer();
      if (t && t.battles > 0) { after = t.rating; if (t.rating !== this.ratingBefore || i > 1) break; }
      await new Promise((r) => setTimeout(r, 400));
    }
    const mySeat = this.seat();
    const winner: Side = a.winner === mySeat ? 0 : 1;
    const result: BattleResult = { winner, turns: a.match.turn, ratingBefore: this.ratingBefore, ratingAfter: after };
    this.emit({ result });
    const t = useChain.getState().trainer;
    if (t && t.unsaved > 0 && t.commits < 9 && (t.commits < 6 || t.unsaved >= 3)) {
      try {
        const r = await getClient().commitTrainer(guestSigner());
        useProof.getState().set({ saved: { label: 'commit_trainer', sig: r.sig, link: r.link, ms: r.ms } });
        this.emit({ result: { ...result, signature: r.sig } });
      } catch { /* stays delegated, safe */ }
    }
  }

  async leave(): Promise<void> {
    this.stops.forEach((s) => s()); this.stops = [];
    if (this.timeoutTimer) clearInterval(this.timeoutTimer);
    const a = this.arena;
    if (!this.ended && a && (a.phase === PHASE.PICKING || a.phase === PHASE.REVEALING)) {
      try { await getClient().forfeit(guestSigner(), this.hostKey, new PublicKey(a.guest)); } catch { /* already over */ }
    }
    this.ended = true;
  }
}
