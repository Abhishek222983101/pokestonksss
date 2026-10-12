import { AnchorProvider, Program, type Idl } from "@coral-xyz/anchor";
import { Connection, PublicKey, type TransactionInstruction } from "@solana/web3.js";
import { sha256 } from "@noble/hashes/sha256";
import idl from "./idl/pokestonksss.json";
import { ChainConfig, ER_VRF_QUEUE, FEEDS } from "./config";
import { arenaPda, trainerPda } from "./pda";
import { ArenaView, TrainerView, decodeLog, decodeMatch } from "./state";
import { Latency } from "./latency";
import { sendBase, sendEr, TxSigner, type Sent, waitFor } from "./tx";
import { txLink } from "./explorer";

export type Layer = "base" | "er";
export interface Receipt extends Sent { link: string; layer: Layer }

const dummyWallet = { publicKey: PublicKey.default, signTransaction: async <T,>(t: T) => t, signAllTransactions: async <T,>(t: T[]) => t };

/** All chain access for the game. No server involved: base layer + MagicBlock ER only. */
export class GameClient {
  readonly base: Connection;
  readonly er: Connection;
  readonly latency = new Latency();
  private readonly program: Program<Idl>;

  constructor(readonly cfg: ChainConfig) {
    this.base = new Connection(cfg.baseHttp, "confirmed");
    this.er = new Connection(cfg.erHttp, { commitment: "confirmed", wsEndpoint: cfg.erWs });
    this.program = new Program(idl as Idl, new AnchorProvider(this.base, dummyWallet as never, {}));
  }

  // ----------------------------------------------------------------------------------------- reads
  private conn(layer: Layer) { return layer === "er" ? this.er : this.base; }

  async getTrainer(owner: PublicKey, layer: Layer = "er"): Promise<TrainerView | null> {
    const info = await this.conn(layer).getAccountInfo(trainerPda(owner, this.cfg.programId));
    return info ? this.decodeTrainer(info.data) : null;
  }
  decodeTrainer(data: Buffer | Uint8Array): TrainerView {
    const t: any = this.program.coder.accounts.decode("trainer", Buffer.from(data));
    return { owner: t.owner.toBase58(), rating: t.rating, wins: t.wins, losses: t.losses, streak: t.streak, dex: t.dex, battles: t.battles, unsaved: t.unsaved, commits: t.commits, nameSeed: t.nameSeed };
  }
  async getArena(owner: PublicKey, layer: Layer = "er"): Promise<ArenaView | null> {
    const info = await this.conn(layer).getAccountInfo(arenaPda(owner, this.cfg.programId));
    return info ? this.decodeArena(info.data) : null;
  }
  decodeArena(data: Buffer | Uint8Array): ArenaView {
    const a: any = this.program.coder.accounts.decode("arena", Buffer.from(data));
    return {
      host: a.host.toBase58(), guest: a.guest.toBase58(), mode: a.mode, phase: a.phase, tier: a.tier,
      match: decodeMatch(a.state), picks: [a.picks[0], a.picks[1]], committedMask: a.committedMask, revealedMask: a.revealedMask,
      vrfPending: a.vrfPending, deadline: Number(a.deadline), updatedAt: Number(a.updatedAt),
      snap: [BigInt(a.snap[0].toString()), BigInt(a.snap[1].toString())], winner: a.winner, log: decodeLog(a.log, a.logLen),
    };
  }

  /** Subscribe to an arena on the ER websocket with a 2 s poll fallback. Returns an unsubscribe function. */
  watchArena(owner: PublicKey, cb: (a: ArenaView) => void): () => void {
    const pda = arenaPda(owner, this.cfg.programId);
    let last = "";
    const push = (data: Buffer | Uint8Array) => {
      const key = Buffer.from(data).toString("base64");
      if (key === last) return;
      last = key;
      try { cb(this.decodeArena(data)); } catch { /* ignore a torn read */ }
    };
    let id: number | undefined;
    try { id = this.er.onAccountChange(pda, (i) => push(i.data), "confirmed"); } catch { /* poll only */ }
    let stopped = false;
    const poll = async () => {
      while (!stopped) {
        try { const i = await this.er.getAccountInfo(pda); if (i) push(i.data); } catch { /* retry */ }
        await new Promise((r) => setTimeout(r, 2000));
      }
    };
    void poll();
    return () => { stopped = true; if (id !== undefined) void this.er.removeAccountChangeListener(id).catch(() => {}); };
  }

  // ----------------------------------------------------------------------------------------- tx plumbing
  private async er_(ixs: TransactionInstruction[], signer: TxSigner): Promise<Receipt> {
    const r = await sendEr(this.er, ixs, signer, this.latency);
    return { ...r, layer: "er", link: txLink(r.sig, "er", this.cfg) };
  }
  private async base_(ixs: TransactionInstruction[], signer: TxSigner): Promise<Receipt> {
    const r = await sendBase(this.base, ixs, signer);
    return { ...r, layer: "base", link: txLink(r.sig, "base", this.cfg) };
  }
  private m() { return this.program.methods as any; }

  // ----------------------------------------------------------------------------------------- onboarding (base layer)
  async onboardIx(owner: PublicKey, nameSeed = Math.floor(Math.random() * 2 ** 31)) {
    return this.m().onboard(nameSeed).accounts({ trainer: trainerPda(owner, this.cfg.programId), arena: arenaPda(owner, this.cfg.programId), payer: owner }).instruction() as Promise<TransactionInstruction>;
  }
  async delegateIx(owner: PublicKey) {
    return this.m().delegateAll().accounts({ payer: owner, trainer: trainerPda(owner, this.cfg.programId), arena: arenaPda(owner, this.cfg.programId) })
      .remainingAccounts([{ pubkey: this.cfg.validator, isSigner: false, isWritable: false }]).instruction() as Promise<TransactionInstruction>;
  }
  onboard(signer: TxSigner) { return this.onboardIx(signer.publicKey).then((ix) => this.base_([ix], signer)); }
  delegate(signer: TxSigner) { return this.delegateIx(signer.publicKey).then((ix) => this.base_([ix], signer)); }
  /** One tx: create + delegate. Falls back to two txs if the combined one is rejected. */
  async onboardAndDelegate(signer: TxSigner): Promise<Receipt[]> {
    const [a, b] = await Promise.all([this.onboardIx(signer.publicKey), this.delegateIx(signer.publicKey)]);
    try { return [await this.base_([a, b], signer)]; }
    catch { return [await this.base_([a], signer), await this.base_([b], signer)]; }
  }
  async waitCloned(owner: PublicKey, timeoutMs = 45_000) {
    await waitFor(async () => {
      const [t, a] = await Promise.all([this.er.getAccountInfo(trainerPda(owner, this.cfg.programId)), this.er.getAccountInfo(arenaPda(owner, this.cfg.programId))]);
      return t && a ? true : null;
    }, { timeoutMs, pollMs: 120, label: "ER clone" });
  }

  // ----------------------------------------------------------------------------------------- practice (ER)
  async startPractice(signer: TxSigner, species: number, oppSpecies: number, tier = 1) {
    const ix = await this.m().startPractice(species, oppSpecies, tier).accounts({
      arena: arenaPda(signer.publicKey, this.cfg.programId), trainer: trainerPda(signer.publicKey, this.cfg.programId), signer: signer.publicKey,
      feedA: FEEDS[species], feedB: FEEDS[oppSpecies],
    }).instruction();
    return this.er_([ix], signer);
  }
  async lockPick(signer: TxSigner, slot: number) {
    const ix = await this.m().lockPick(slot).accounts({ arena: arenaPda(signer.publicKey, this.cfg.programId), signer: signer.publicKey, oracleQueue: ER_VRF_QUEUE }).instruction();
    return this.er_([ix], signer);
  }

  // ----------------------------------------------------------------------------------------- duel (ER)
  static newToken(): Uint8Array { return crypto.getRandomValues(new Uint8Array(32)); }
  static tokenHash(token: Uint8Array): number[] { return Array.from(sha256(token)); }
  /** commitment = sha256(slot ‖ salt ‖ arena ‖ turn ‖ player) — must match the program. */
  static commitment(slot: number, salt: Uint8Array, arena: PublicKey, turn: number, player: PublicKey): number[] {
    const buf = new Uint8Array(1 + 32 + 32 + 1 + 32);
    buf[0] = slot; buf.set(salt, 1); buf.set(arena.toBytes(), 33); buf[65] = turn; buf.set(player.toBytes(), 66);
    return Array.from(sha256(buf));
  }
  async openDuel(signer: TxSigner, species: number, token: Uint8Array) {
    const ix = await this.m().openDuel(species, GameClient.tokenHash(token)).accounts({ arena: arenaPda(signer.publicKey, this.cfg.programId), trainer: trainerPda(signer.publicKey, this.cfg.programId), signer: signer.publicKey }).instruction();
    return this.er_([ix], signer);
  }
  async cancelDuel(signer: TxSigner) {
    return this.er_([await this.m().cancelDuel().accounts({ arena: arenaPda(signer.publicKey, this.cfg.programId), signer: signer.publicKey }).instruction()], signer);
  }
  async joinDuel(signer: TxSigner, host: PublicKey, hostSpecies: number, species: number, token: Uint8Array) {
    const ix = await this.m().joinDuel(species, Array.from(token)).accounts({
      arena: arenaPda(host, this.cfg.programId), guestTrainer: trainerPda(signer.publicKey, this.cfg.programId), signer: signer.publicKey, feedA: FEEDS[hostSpecies], feedB: FEEDS[species],
    }).instruction();
    return this.er_([ix], signer);
  }
  async commitPick(signer: TxSigner, host: PublicKey, hash: number[]) {
    return this.er_([await this.m().commitPick(hash).accounts({ arena: arenaPda(host, this.cfg.programId), signer: signer.publicKey }).instruction()], signer);
  }
  async revealPick(signer: TxSigner, host: PublicKey, slot: number, salt: Uint8Array) {
    const ix = await this.m().revealPick(slot, Array.from(salt)).accounts({ arena: arenaPda(host, this.cfg.programId), signer: signer.publicKey, oracleQueue: ER_VRF_QUEUE }).instruction();
    return this.er_([ix], signer);
  }
  async claimTimeout(signer: TxSigner, host: PublicKey, guest: PublicKey) {
    const ix = await this.m().claimTimeout().accounts({
      arena: arenaPda(host, this.cfg.programId), hostTrainer: trainerPda(host, this.cfg.programId), guestTrainer: trainerPda(guest, this.cfg.programId), signer: signer.publicKey, oracleQueue: ER_VRF_QUEUE,
    }).instruction();
    return this.er_([ix], signer);
  }
  async forfeit(signer: TxSigner, host: PublicKey, guest: PublicKey) {
    const ix = await this.m().forfeit().accounts({
      arena: arenaPda(host, this.cfg.programId), hostTrainer: trainerPda(host, this.cfg.programId), guestTrainer: trainerPda(guest, this.cfg.programId), signer: signer.publicKey,
    }).instruction();
    return this.er_([ix], signer);
  }
  async resetArena(signer: TxSigner) {
    return this.er_([await this.m().resetArena().accounts({ arena: arenaPda(signer.publicKey, this.cfg.programId), signer: signer.publicKey }).instruction()], signer);
  }

  // ----------------------------------------------------------------------------------------- save to Solana
  async commitTrainer(signer: TxSigner) {
    const ix = await this.m().commitTrainer().accounts({ trainer: trainerPda(signer.publicKey, this.cfg.programId), signer: signer.publicKey }).instruction();
    return this.er_([ix], signer);
  }
  async saveAndLeave(signer: TxSigner) {
    const ix = await this.m().saveAndLeave().accounts({ trainer: trainerPda(signer.publicKey, this.cfg.programId), arena: arenaPda(signer.publicKey, this.cfg.programId), signer: signer.publicKey }).instruction();
    return this.er_([ix], signer);
  }
}
