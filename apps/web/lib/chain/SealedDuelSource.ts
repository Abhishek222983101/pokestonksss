import { Keypair, PublicKey } from '@solana/web3.js';
import { SEALED, SEALED_TURN_TIMEOUT_S, keypairSigner, type SealedDuelView, type TeeSession } from '@pokestonksss/sdk';
import type { BattleResult, BattleSnapshot, BattleSource, TurnRecord } from '../battleSource';
import { rules, type MatchState, type Mood, type Side, type Slot } from '../rules';
import { swapEvent, type DuelRole } from './ChainDuelSource';
import { getSealed } from './sealed';
import { useSealedProof } from './sealedProof';
import { useChain, friendly } from './store';

const TURN_MS = SEALED_TURN_TIMEOUT_S * 1000;
const hex = (a: ArrayLike<number>) => Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');

/**
 * Sealed duel on the Private ER (TEE). Side 0 is always the local player: the guest's on-chain orientation
 * (host = side 0) is mirrored before it reaches the scene. Signing is done by the per-match key only.
 */
export class SealedDuelSource implements BattleSource {
  private subs = new Set<(s: BattleSnapshot) => void>();
  private snap: BattleSnapshot;
  private duel: SealedDuelView | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private ended = false;
  private busy = false;
  private resolving = false;
  private finishing = false;
  private myLockedTurn = -1;
  private readonly signer;
  private readonly seat: 0 | 1;
  private readonly opponentName: string;

  constructor(private role: DuelRole, private host: PublicKey, private kp: Keypair, private tee: TeeSession, private players: [PublicKey, PublicKey], private species: [number, number]) {
    this.signer = keypairSigner(kp);
    this.seat = role === 'host' ? 0 : 1;
    const foe = players[1 - this.seat];
    this.opponentName = `Friend ${foe.toBase58().slice(0, 4)}…`;
    const roster = rules.roster();
    const me = species[this.seat], them = species[1 - this.seat];
    this.snap = {
      onChain: true, kind: 'private', phase: 'RESOLVING', champions: [roster[me], roster[them]], opponent: { label: this.opponentName, isBot: false },
      state: rules.newMatch(me, them), mood: [0, 0], movePct: [0, 0], locked: true, turns: [], result: null, turnMs: TURN_MS,
    };
  }

  /** Start watching the duel on the TEE. */
  async attach() {
    const first = await getSealed().readDuel(this.host, this.tee.conn);
    if (first) this.onDuel(first);
    this.timer = setInterval(() => void this.poll(), 450);
    await this.checkMyPermission();
  }

  private async poll() {
    if (this.ended) return;
    try {
      const d = await getSealed().readDuel(this.host, this.tee.conn);
      if (d) this.onDuel(d);
    } catch { /* retry on the next tick */ }
  }

  /** Records the on-chain statement of who may read my sealed pick (the TEE enforces it). */
  private async checkMyPermission() {
    try {
      const s = getSealed();
      const pick = s.pick(this.host, this.players[this.seat]);
      const p = await s.readPermission(this.tee.conn, pick);
      useSealedProof.getState().patch({ myPermission: { account: pick.toBase58(), members: p.members, isPrivate: p.isPrivate } });
    } catch { /* informational */ }
  }

  /** "Peek proof": try to read the opponent's sealed pick with my own token, and anonymously. Both must fail. */
  async peek() {
    const s = getSealed();
    const mine = await s.peekPick(this.tee.conn, this.host, this.players[this.seat]);
    const theirs = await s.peekPick(this.tee.conn, this.host, this.players[1 - this.seat]);
    const anon = await s.peekPick(s.publicTee(), this.host, this.players[this.seat]);
    useSealedProof.getState().patch({ peek: { at: Date.now(), mine: mine.visible, theirs: theirs.visible, anon: anon.visible } });
    return { mine: mine.visible, theirs: theirs.visible, anon: anon.visible };
  }

  getSnapshot() { return this.snap; }
  subscribe(cb: (s: BattleSnapshot) => void) { this.subs.add(cb); return () => { this.subs.delete(cb); }; }
  private emit(p: Partial<BattleSnapshot>) { this.snap = { ...this.snap, ...p }; this.subs.forEach((f) => f(this.snap)); }
  private mirror(s: MatchState): MatchState { return { turn: s.turn, fighters: [s.fighters[1], s.fighters[0]] }; }

  private replay(d: SealedDuelView): { turns: TurnRecord[]; state: MatchState } {
    let state = rules.newMatch(d.species[0], d.species[1]);
    const turns: TurnRecord[] = [];
    const guest = this.role === 'guest';
    for (const e of d.log) {
      const rnd = new Uint8Array(32); rnd.set(e.rnd);
      const res = rules.resolveTurn(state, e.picks as [Slot, Slot], rnd, [0, 0] as [Mood, Mood]);
      state = res.state;
      const picks = (guest ? [e.picks[1], e.picks[0]] : e.picks) as [Slot, Slot];
      turns.push({ turn: res.state.turn, picks, events: guest ? res.events.map(swapEvent) : res.events, state: guest ? this.mirror(res.state) : res.state });
    }
    return { turns, state };
  }

  private onDuel(d: SealedDuelView) {
    const prevLog = this.duel?.log.length ?? -1;
    this.duel = d;
    const { turns } = this.replay(d);
    const f = d.match.sides;
    const onChain: MatchState = {
      turn: d.match.turn,
      fighters: [
        { champ: d.species[0], hp: f[0].hp, maxHp: f[0].maxHp, charged: f[0].charged, lastGuard: f[0].lastGuard, momentum: f[0].momentum, level: 0 },
        { champ: d.species[1], hp: f[1].hp, maxHp: f[1].maxHp, charged: f[1].charged, lastGuard: f[1].lastGuard, momentum: f[1].momentum, level: 0 },
      ],
    };
    const finished = d.status === SEALED.FINISHED;
    const iLocked = (d.lockedMask & (1 << this.seat)) !== 0;
    const locked = finished || iLocked || d.status !== SEALED.LIVE;
    // new turns resolved: record the roll proofs
    if (d.log.length !== prevLog) {
      const st = useSealedProof.getState();
      if (d.log.length > 0) st.step({ id: 'rolls', label: `${d.log.length} turn${d.log.length === 1 ? '' : 's'} resolved inside the TEE`, note: `last roll 0x${hex(d.log[d.log.length - 1].rnd)}` });
    }
    this.emit({
      state: this.role === 'guest' ? this.mirror(onChain) : onChain,
      turns,
      phase: finished ? 'FINISHED' : locked ? 'RESOLVING' : 'PICKING',
      locked,
      oppLocked: (d.lockedMask & (1 << (1 - this.seat))) !== 0,
      deadlineMs: d.status === SEALED.LIVE ? (d.lockTs + SEALED_TURN_TIMEOUT_S) * 1000 : undefined,
    });
    if (d.status === SEALED.LIVE && d.lockedMask === 3) void this.tryResolve();
    if (d.status === SEALED.LIVE && (d.lockedMask === 1 || d.lockedMask === 2)) void this.maybeTimeout(d);
    if (finished && !this.ended) void this.finish(d);
  }

  /** Both picks are sealed: anyone may resolve. The host goes first, the guest backs it up. */
  private async tryResolve() {
    if (this.resolving) return;
    this.resolving = true;
    try {
      if (this.role === 'guest') await new Promise((r) => setTimeout(r, 1600));
      for (let i = 0; i < 10; i++) {
        const d = this.duel;
        if (!d || d.status !== SEALED.LIVE || d.lockedMask !== 3) break;
        try {
          const r = await getSealed().resolve(this.tee.conn, this.signer, this.host, this.players);
          useSealedProof.getState().step({ id: `resolve${d.log.length}`, label: `resolve turn ${d.log.length + 1} (TEE)`, link: r.link, ms: r.ms });
          break;
        } catch { await new Promise((r) => setTimeout(r, 350)); }
      }
    } finally { this.resolving = false; }
  }

  private async maybeTimeout(d: SealedDuelView) {
    if (this.busy || Date.now() / 1000 < d.lockTs + SEALED_TURN_TIMEOUT_S + 2) return;
    this.busy = true;
    try { await getSealed().timeout(this.tee.conn, this.signer, this.host); } catch { /* not due yet or already settled */ }
    this.busy = false;
  }

  async lock(slot: Slot): Promise<void> {
    const d = this.duel;
    if (!d || d.status !== SEALED.LIVE || this.ended || this.busy || (d.lockedMask & (1 << this.seat)) !== 0) return;
    this.busy = true;
    // the nonce is the secret half of the roll: 48 random bits, sealed with the pick, public only after the turn resolves
    const nonce = BigInt(Math.floor(Math.random() * 2 ** 48));
    this.emit({ locked: true, phase: 'RESOLVING' });
    try {
      const r = await getSealed().lock(this.tee.conn, this.signer, this.host, slot, nonce);
      this.myLockedTurn = d.match.turn;
      useSealedProof.getState().step({ id: `lock${d.match.turn}`, label: `sealed pick, turn ${d.match.turn + 1} (TEE)`, link: r.link, ms: r.ms });
    } catch (e) {
      this.emit({ locked: false, phase: 'PICKING' });
      throw new Error(friendly(e));
    } finally { this.busy = false; }
  }

  private async finish(d: SealedDuelView) {
    this.ended = true;
    if (this.timer) clearInterval(this.timer);
    const mySeat = this.seat;
    const winner: Side = d.winner === mySeat ? 0 : 1;
    const rating = useChain.getState().trainer?.rating ?? 1000;
    const result: BattleResult = { winner, turns: d.match.turn, ratingBefore: rating, ratingAfter: rating };
    this.emit({ result });
    if (this.role === 'host' && !this.finishing) {
      this.finishing = true;
      try {
        const f = await getSealed().finish(this.tee.conn, this.signer, this.host, this.players);
        useSealedProof.getState().patch({ committed: { link: f.link, ms: f.ms } });
        useSealedProof.getState().step({ id: 'finish', label: 'finish: commit + undelegate to Solana (TEE)', link: f.link, ms: f.ms });
        this.emit({ result: { ...result, signature: f.sig } });
        await getSealed().waitCommitted(this.host).catch(() => undefined);
      } catch { /* the duel is still safely settled inside the TEE */ }
    } else if (this.role === 'guest') {
      // the host commits; the guest just waits for it so the result screen can show the proof
      const c = await getSealed().waitCommitted(this.host, 60_000).catch(() => null);
      if (c) this.emit({ result: { ...result, signature: 'committed' } });
    }
  }

  async leave(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.ended = true;
  }
}
