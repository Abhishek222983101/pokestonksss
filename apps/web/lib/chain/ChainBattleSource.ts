import { PublicKey } from '@solana/web3.js';
import { PHASE, txLink, type ArenaView } from '@pokestonksss/sdk';
import type { BattleResult, BattleSnapshot, BattleSource, TurnRecord } from '../battleSource';
import { rules, type MatchState, type Mood, type Slot } from '../rules';
import { getClient } from './config';
import { guestKeypair, guestSigner } from './guest';
import { moodOf, watchPrice } from './oracle';
import { useProof } from './proof';
import { friendly, useChain } from './store';

const TURN_MS = 30_000;
const hex = (a: ArrayLike<number>) => Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');

/** Practice battle on the Ephemeral Rollup: the snapshot is a pure function of the on-chain Arena account. */
export class ChainBattleSource implements BattleSource {
  private subs = new Set<(s: BattleSnapshot) => void>();
  private snap: BattleSnapshot;
  private arena: ArenaView | null = null;
  private stops: Array<() => void> = [];
  private nowRaw: [bigint | null, bigint | null] = [null, null];
  private localLocked = false;
  private lockedAtLog = 0;
  private ratingBefore = 1000;
  private ended = false;
  private starting: Promise<void>;
  /** True if replaying the stored log reproduces the on-chain state (the Verify page's check). */
  integrityOk = true;

  constructor(private player: number, private foe: number, private tier = 1) {
    const roster = rules.roster();
    this.snap = {
      phase: 'RESOLVING',
      champions: [roster[player], roster[foe]],
      opponent: { label: 'House Agent', isBot: true },
      state: rules.newMatch(player, foe),
      mood: [0, 0], movePct: [0, 0], locked: true, turns: [], result: null, turnMs: TURN_MS,
    };
    this.starting = this.start();
  }

  /** Resolves when the battle is live on the rollup (rejects with a friendly error otherwise). */
  ready() { return this.starting; }

  private async start() {
    const client = getClient();
    const signer = guestSigner();
    useProof.getState().reset();
    try {
      const t = await client.getTrainer(guestKeypair().publicKey);
      if (t) this.ratingBefore = t.rating;
      const r = await client.startPractice(signer, this.player, this.foe, this.tier);
      useProof.getState().set({ start: { label: 'start_practice', sig: r.sig, link: r.link, ms: r.ms } });
      this.stops.push(client.watchArena(guestKeypair().publicKey, (a) => this.onArena(a)));
      this.stops.push(watchPrice(client.er, this.player, (p) => { this.nowRaw[0] = p.raw; this.refreshMood(); }));
      this.stops.push(watchPrice(client.er, this.foe, (p) => { this.nowRaw[1] = p.raw; this.refreshMood(); }));
      const a = await client.getArena(guestKeypair().publicKey);
      if (a) this.onArena(a);
    } catch (e) {
      this.ended = true;
      throw new Error(friendly(e));
    }
  }

  getSnapshot() { return this.snap; }

  subscribe(cb: (s: BattleSnapshot) => void) {
    this.subs.add(cb);
    return () => { this.subs.delete(cb); };
  }

  private emit(p: Partial<BattleSnapshot>) {
    this.snap = { ...this.snap, ...p };
    this.subs.forEach((f) => f(this.snap));
  }

  private refreshMood() {
    const a = this.arena;
    if (!a) return;
    const mood: [Mood, Mood] = [moodOf(a.snap[0], this.nowRaw[0]), moodOf(a.snap[1], this.nowRaw[1])];
    const pct = (i: 0 | 1): number => (a.snap[i] > 0n && this.nowRaw[i] ? Number(((this.nowRaw[i]! - a.snap[i]) * 100000n) / a.snap[i]) / 1000 : 0);
    const movePct: [number, number] = [pct(0), pct(1)];
    useProof.getState().set({
      weighed: { snap: [a.snap[0].toString(), a.snap[1].toString()], now: [String(this.nowRaw[0] ?? 0), String(this.nowRaw[1] ?? 0)], mood },
    });
    this.emit({ mood, movePct });
  }

  /** Rebuild every resolved turn by replaying the on-chain log through the shared rules. */
  private replay(a: ArenaView): { turns: TurnRecord[]; state: MatchState } {
    let state = rules.newMatch(this.player, this.foe);
    const turns: TurnRecord[] = [];
    for (const e of a.log) {
      const rnd = new Uint8Array(32);
      rnd.set(e.rnd);
      const res = rules.resolveTurn(state, e.picks as [Slot, Slot], rnd, e.mood as [Mood, Mood]);
      state = res.state;
      turns.push({ turn: res.state.turn, picks: e.picks as [Slot, Slot], events: res.events, state: res.state });
    }
    return { turns, state };
  }

  private onArena(a: ArenaView) {
    this.arena = a;
    const { turns, state } = this.replay(a);
    const f = a.match.sides;
    this.integrityOk = state.turn === a.match.turn && state.fighters[0].hp === f[0].hp && state.fighters[1].hp === f[1].hp;
    // attach each turn's randomness to its Rolled receipt
    const proof = useProof.getState();
    if (proof.rolled.length) {
      const rolled = proof.rolled.map((r, i) => (a.log[i] ? { ...r, rnd: hex(a.log[i].rnd) } : r));
      proof.set({ rolled });
    }
    const finished = a.phase === PHASE.FINISHED;
    // our own lock stays in force until the roll for it shows up in the on-chain log (or the match ended)
    if (this.localLocked && (a.log.length > this.lockedAtLog || finished)) this.localLocked = false;
    const resolving = a.vrfPending || a.phase === PHASE.ROLLING || this.localLocked;
    this.emit({
      state: { turn: a.match.turn, fighters: [
        { champ: this.player, hp: f[0].hp, maxHp: f[0].maxHp, charged: f[0].charged, lastGuard: f[0].lastGuard },
        { champ: this.foe, hp: f[1].hp, maxHp: f[1].maxHp, charged: f[1].charged, lastGuard: f[1].lastGuard },
      ] },
      turns,
      phase: finished ? 'FINISHED' : resolving ? 'RESOLVING' : 'PICKING',
      locked: finished || resolving,
    });
    this.refreshMood();
    if (finished && !this.ended) void this.finish(a);
  }

  async lock(slot: Slot): Promise<void> {
    await this.starting;
    if (this.snap.phase !== 'PICKING' || this.ended) return;
    this.localLocked = true;
    this.lockedAtLog = this.arena?.log.length ?? 0;
    this.emit({ locked: true, phase: 'RESOLVING' });
    try {
      const r = await getClient().lockPick(guestSigner(), slot);
      useProof.getState().addRolled({ label: `lock_pick turn ${this.snap.state.turn + 1}`, sig: r.sig, link: r.link, ms: r.ms });
    } catch (e) {
      this.localLocked = false;
      this.emit({ locked: false, phase: 'PICKING' });
      throw new Error(friendly(e));
    }
  }

  private async finish(a: ArenaView) {
    this.ended = true;
    const chain = useChain.getState();
    let after = this.ratingBefore;
    for (let i = 0; i < 6; i++) {
      const t = await chain.refreshTrainer();
      if (t && (t.battles > 0)) { after = t.rating; if (t.rating !== this.ratingBefore || i > 1) break; }
      await new Promise((r) => setTimeout(r, 400));
    }
    const result: BattleResult = { winner: a.winner === 1 ? 1 : 0, turns: a.match.turn, ratingBefore: this.ratingBefore, ratingAfter: after };
    this.emit({ result });
    void this.autoSave();
  }

  /** "Saved to Solana": commit the Trainer (every battle early on, then every 3rd; stays under the 10-commit cap). */
  async autoSave() {
    const t = useChain.getState().trainer;
    if (!t || t.unsaved === 0) return;
    if (t.commits >= 9 || (t.commits >= 6 && t.unsaved < 3)) return;
    try {
      const r = await getClient().commitTrainer(guestSigner());
      useProof.getState().set({ saved: { label: 'commit_trainer', sig: r.sig, link: r.link, ms: r.ms } });
      this.emit({ result: this.snap.result ? { ...this.snap.result, signature: r.sig } : null });
      await useChain.getState().refreshTrainer();
    } catch { /* best effort: the Trainer stays safely delegated */ }
  }

  async leave(): Promise<void> {
    this.stops.forEach((s) => s());
    this.stops = [];
    if (this.ended) return;
    this.ended = true;
    this.emit({ phase: 'FINISHED', locked: true, result: { winner: 1, turns: this.snap.state.turn, ratingBefore: this.ratingBefore, ratingAfter: this.ratingBefore } });
  }

  dispose() { this.stops.forEach((s) => s()); this.stops = []; }

  explorer(sig: string) { return txLink(sig, 'er', getClient().cfg); }
  host(): PublicKey { return guestKeypair().publicKey; }
}
