import { AnchorProvider, Program, type Idl } from "@coral-xyz/anchor";
import { Connection, PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";
import { sha256 } from "@noble/hashes/sha256";
import idl from "./idl/pokestonksss.json";
import { ChainConfig, ER_VRF_QUEUE, FEEDS } from "./config";
import { arenaPda, ataOf, badgeAuthorityPda, badgeMintPda, claimPda, sessionTokenPda, SESSION_PROGRAM_ID, trainerPda, ATA_PROGRAM_ID, TOKEN_PROGRAM_ID } from "./pda";
import { ArenaView, TrainerView, decodeLog, decodeMatch } from "./state";
import { Latency } from "./latency";
import { authorityOf, sendBase, sendEr, TxSigner, type Sent, waitFor } from "./tx";
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
    return { owner: t.owner.toBase58(), rating: t.rating, wins: t.wins, losses: t.losses, streak: t.streak, dex: t.dex, battles: t.battles, unsaved: t.unsaved, commits: t.commits, nameSeed: t.nameSeed, xp: Array.from(t.xp as number[]), avatar: t.avatar };
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

  /** Every Trainer on the rollup (leaderboard). Sorted by rating, then wins. */
  async listTrainers(): Promise<TrainerView[]> {
    const accts = await this.er.getProgramAccounts(this.cfg.programId, { filters: [{ dataSize: 8 + 69 }] });
    const out: TrainerView[] = [];
    for (const a of accts) { try { out.push(this.decodeTrainer(a.account.data)); } catch { /* not a Trainer */ } }
    return out.sort((x, y) => y.rating - x.rating || y.wins - x.wins);
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
  /** Anchor program (instruction builders and account coder), for the sealed duel client. */
  get anchor() { return this.program; }
  /** Accounts every session-aware instruction takes: the optional token is `null` for a plain wallet or guest. */
  private sess(signer: TxSigner) { return { sessionToken: signer.sessionToken ?? null, signer: signer.publicKey }; }
  private owner(signer: TxSigner) { return authorityOf(signer); }

  // ----------------------------------------------------------------------------------------- onboarding (base layer)
  async onboardIx(owner: PublicKey, nameSeed = Math.floor(Math.random() * 2 ** 31), avatar = 0) {
    return this.m().onboard(nameSeed, avatar).accounts({ trainer: trainerPda(owner, this.cfg.programId), arena: arenaPda(owner, this.cfg.programId), payer: owner }).instruction() as Promise<TransactionInstruction>;
  }
  async delegateIx(owner: PublicKey) {
    return this.m().delegateAll().accounts({ payer: owner, trainer: trainerPda(owner, this.cfg.programId), arena: arenaPda(owner, this.cfg.programId) })
      .remainingAccounts([{ pubkey: this.cfg.validator, isSigner: false, isWritable: false }]).instruction() as Promise<TransactionInstruction>;
  }
  onboard(signer: TxSigner, avatar = 0) { return this.onboardIx(signer.publicKey, undefined, avatar).then((ix) => this.base_([ix], signer)); }
  delegate(signer: TxSigner) { return this.delegateIx(signer.publicKey).then((ix) => this.base_([ix], signer)); }
  /** One tx: create + delegate. Falls back to two txs if the combined one is rejected. */
  async onboardAndDelegate(signer: TxSigner, avatar = 0): Promise<Receipt[]> {
    const [a, b] = await Promise.all([this.onboardIx(signer.publicKey, undefined, avatar), this.delegateIx(signer.publicKey)]);
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
    const o = this.owner(signer);
    const ix = await this.m().startPractice(species, oppSpecies, tier).accounts({
      arena: arenaPda(o, this.cfg.programId), trainer: trainerPda(o, this.cfg.programId), ...this.sess(signer),
      feedA: FEEDS[species], feedB: FEEDS[oppSpecies],
    }).instruction();
    return this.er_([ix], signer);
  }
  async lockPick(signer: TxSigner, slot: number) {
    const ix = await this.m().lockPick(slot).accounts({ arena: arenaPda(this.owner(signer), this.cfg.programId), ...this.sess(signer), oracleQueue: ER_VRF_QUEUE }).instruction();
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
    const o = this.owner(signer);
    const ix = await this.m().openDuel(species, GameClient.tokenHash(token)).accounts({ arena: arenaPda(o, this.cfg.programId), trainer: trainerPda(o, this.cfg.programId), ...this.sess(signer) }).instruction();
    return this.er_([ix], signer);
  }
  async cancelDuel(signer: TxSigner) {
    return this.er_([await this.m().cancelDuel().accounts({ arena: arenaPda(this.owner(signer), this.cfg.programId), ...this.sess(signer) }).instruction()], signer);
  }
  async joinDuel(signer: TxSigner, host: PublicKey, hostSpecies: number, species: number, token: Uint8Array) {
    const ix = await this.m().joinDuel(species, Array.from(token)).accounts({
      arena: arenaPda(host, this.cfg.programId), guestTrainer: trainerPda(this.owner(signer), this.cfg.programId), ...this.sess(signer), feedA: FEEDS[hostSpecies], feedB: FEEDS[species],
    }).instruction();
    return this.er_([ix], signer);
  }
  async commitPick(signer: TxSigner, host: PublicKey, hash: number[]) {
    return this.er_([await this.m().commitPick(hash).accounts({ arena: arenaPda(host, this.cfg.programId), trainer: trainerPda(this.owner(signer), this.cfg.programId), ...this.sess(signer) }).instruction()], signer);
  }
  async revealPick(signer: TxSigner, host: PublicKey, slot: number, salt: Uint8Array) {
    const ix = await this.m().revealPick(slot, Array.from(salt)).accounts({ arena: arenaPda(host, this.cfg.programId), trainer: trainerPda(this.owner(signer), this.cfg.programId), ...this.sess(signer), oracleQueue: ER_VRF_QUEUE }).instruction();
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
      arena: arenaPda(host, this.cfg.programId), hostTrainer: trainerPda(host, this.cfg.programId), guestTrainer: trainerPda(guest, this.cfg.programId),
      actor: trainerPda(this.owner(signer), this.cfg.programId), ...this.sess(signer),
    }).instruction();
    return this.er_([ix], signer);
  }
  async resetArena(signer: TxSigner) {
    return this.er_([await this.m().resetArena().accounts({ arena: arenaPda(this.owner(signer), this.cfg.programId), ...this.sess(signer) }).instruction()], signer);
  }

  // ----------------------------------------------------------------------------------------- save to Solana
  async commitTrainer(signer: TxSigner) {
    const ix = await this.m().commitTrainer().accounts({ trainer: trainerPda(this.owner(signer), this.cfg.programId), ...this.sess(signer) }).instruction();
    return this.er_([ix], signer);
  }
  async saveAndLeave(signer: TxSigner) {
    const ix = await this.m().saveAndLeave().accounts({ trainer: trainerPda(signer.publicKey, this.cfg.programId), arena: arenaPda(signer.publicKey, this.cfg.programId), signer: signer.publicKey }).instruction();
    return this.er_([ix], signer);
  }

  // ----------------------------------------------------------------------------------------- crank (MagicBlock task scheduler)
  /** (Re)arms the crank sweep that settles an abandoned duel. Fire and forget: a failure never blocks play. */
  async armTimer(signer: TxSigner, host: PublicKey) {
    const ix = await this.m().armTimer().accounts({
      arena: arenaPda(host, this.cfg.programId), trainer: trainerPda(this.owner(signer), this.cfg.programId), ...this.sess(signer),
    }).instruction();
    return this.er_([ix], signer);
  }

  // ----------------------------------------------------------------------------------------- session keys (base layer)
  /**
   * `create_session_v2` of the GPL session keys program, hand encoded (no extra dependency). Both the authority wallet
   * (fee payer) and the fresh session key must sign the transaction. `validUntil` is unix seconds, at most 7 days out.
   */
  createSessionIx(authority: PublicKey, sessionSigner: PublicKey, validUntil: number, topUpLamports = 0): TransactionInstruction {
    // plain Uint8Array + DataView: the browser Buffer polyfill has no writeBigInt64LE
    const data = new Uint8Array(8 + 2 + 9 + 9);
    const dv = new DataView(data.buffer);
    data.set([223, 233, 108, 7, 65, 194, 235, 38], 0);
    let o = 8;
    data[o++] = 1; data[o++] = topUpLamports > 0 ? 1 : 0;
    data[o++] = 1; dv.setBigInt64(o, BigInt(validUntil), true); o += 8;
    data[o++] = 1; dv.setBigUint64(o, BigInt(topUpLamports), true); o += 8;
    return new TransactionInstruction({
      programId: SESSION_PROGRAM_ID,
      keys: [
        { pubkey: sessionTokenPda(sessionSigner, authority, this.cfg.programId), isSigner: false, isWritable: true },
        { pubkey: sessionSigner, isSigner: true, isWritable: true },
        { pubkey: authority, isSigner: true, isWritable: true },
        { pubkey: authority, isSigner: true, isWritable: false },
        { pubkey: this.cfg.programId, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: Buffer.from(data.subarray(0, o)),
    });
  }
  /** True when a usable (existing, program owned) session token is on chain for this pair. */
  async sessionActive(sessionSigner: PublicKey, authority: PublicKey): Promise<boolean> {
    const info = await this.base.getAccountInfo(sessionTokenPda(sessionSigner, authority, this.cfg.programId));
    return !!info && info.owner.equals(SESSION_PROGRAM_ID);
  }

  // ----------------------------------------------------------------------------------------- badges (base layer)
  mintBadgeIx(payer: PublicKey, owner: PublicKey, id: number): Promise<TransactionInstruction> {
    const mint = badgeMintPda(id, this.cfg.programId);
    return this.m().mintBadge(id).accounts({
      payer, owner, trainer: trainerPda(owner, this.cfg.programId), badgeMint: mint, badgeAuthority: badgeAuthorityPda(this.cfg.programId),
      ownerAta: ataOf(owner, mint), claim: claimPda(owner, id, this.cfg.programId),
      tokenProgram: TOKEN_PROGRAM_ID, associatedTokenProgram: ATA_PROGRAM_ID, systemProgram: SystemProgram.programId,
    }).instruction() as Promise<TransactionInstruction>;
  }
  async mintBadge(payer: TxSigner, owner: PublicKey, id: number) {
    return this.base_([await this.mintBadgeIx(payer.publicKey, owner, id)], payer);
  }
  /** Badge ids already minted to `owner` (a claim record exists). */
  async claimedBadges(owner: PublicKey): Promise<number[]> {
    const ids = Array.from({ length: 16 }, (_, i) => i);
    const infos = await this.base.getMultipleAccountsInfo(ids.map((i) => claimPda(owner, i, this.cfg.programId)));
    return ids.filter((_, i) => !!infos[i]);
  }
}
