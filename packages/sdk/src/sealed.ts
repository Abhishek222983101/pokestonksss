/**
 * Sealed duels on a MagicBlock Private Ephemeral Rollup (Intel TDX TEE).
 *
 * Flow (see programs/pokestonksss/src/sealed.rs):
 *   base:  create (host) -> join (guest) -> request_seed (MagicBlock VRF) -> delegate x3 to the TEE validator
 *   TEE:   open (private permissions on both picks) -> lock (sealed pick + secret nonce) -> resolve -> ... -> finish
 * Every actor is a throwaway per-match key, so nothing links a private duel to a wallet.
 */
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction } from "@solana/web3.js";
import { sha256 } from "@noble/hashes/sha256";
import { GameClient } from "./client";
import { PROGRAM_ID } from "./config";
import { MatchView, decodeMatch } from "./state";
import { sendBase, sendEr, sleep, waitFor, TxSigner, keypairSigner, type Sent } from "./tx";
import { txLink } from "./explorer";

export const TEE_HTTP = "https://devnet-tee.magicblock.app";
export const TEE_WS = "wss://devnet-tee.magicblock.app";
/** Validator identity for `DelegateConfig.validator` (== getIdentity of devnet-tee). */
export const TEE_VALIDATOR = new PublicKey("MTEWGuqxUpYZGFJQcp8tLN7x5v9BSeoFHYWQQ3n3xzo");
export const PERMISSION_PROGRAM = new PublicKey("ACLseoPoyC3cBqoUtkbjZ4aDrkurZW86v19pXz2XQnp1");
export const EPHEMERAL_VAULT = new PublicKey("MagicVau1t999999999999999999999999999999999");
export const MAGIC_PROGRAM = new PublicKey("Magic11111111111111111111111111111111111111");
/** MagicBlock VRF base-layer queue (the rollup queue is not served inside the TEE). */
export const VRF_BASE_QUEUE = new PublicKey("Cuj97ggrhhidhbu39TijNVqE74xvKJ69gDervRUXAxGh");

export const SEALED = { OPEN: 0, JOINED: 1, SEEDED: 2, LIVE: 3, FINISHED: 4 } as const;
export const SEALED_TURN_TIMEOUT_S = 40;

export const duelPda = (host: PublicKey, programId = PROGRAM_ID) =>
  PublicKey.findProgramAddressSync([Buffer.from("sduel"), host.toBuffer()], programId)[0];
export const spickPda = (duel: PublicKey, player: PublicKey, programId = PROGRAM_ID) =>
  PublicKey.findProgramAddressSync([Buffer.from("spick"), duel.toBuffer(), player.toBuffer()], programId)[0];
export const permissionPda = (account: PublicKey) =>
  PublicKey.findProgramAddressSync([Buffer.from("permission:"), account.toBuffer()], PERMISSION_PROGRAM)[0];

export interface SealedTurnView { picks: [number, number]; nonces: [bigint, bigint]; rnd: number[] }
export interface SealedDuelView {
  status: number; players: [string, string]; species: [number, number]; match: MatchView; lockedMask: number;
  lockSlot: number; lockTs: number; progressTs: number; seed: string; winner: number; log: SealedTurnView[];
}

/** roll = sha256(domain ‖ seed ‖ turn ‖ picks ‖ nonceA ‖ nonceB): the same function the program runs. */
export function deriveRoll(seed: Uint8Array, turn: number, picks: [number, number], nonces: [bigint, bigint]): Uint8Array {
  const dom = new TextEncoder().encode("pokestonksss/sealed-roll");
  const buf = new Uint8Array(dom.length + 32 + 1 + 2 + 16);
  const dv = new DataView(buf.buffer);
  let o = 0;
  buf.set(dom, o); o += dom.length;
  buf.set(seed, o); o += 32;
  buf[o++] = turn;
  buf[o++] = picks[0]; buf[o++] = picks[1];
  dv.setBigUint64(o, nonces[0], true); o += 8;
  dv.setBigUint64(o, nonces[1], true);
  return sha256(buf);
}

export interface TeeSession { conn: Connection; token: string; expiresAtMs: number }
export interface SealedReceipt extends Sent { link: string; layer: "base" | "tee" }

const b58 = (() => {
  const A = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  return (bytes: Uint8Array) => {
    let n = 0n; for (const b of bytes) n = (n << 8n) | BigInt(b);
    let out = ""; while (n > 0n) { out = A[Number(n % 58n)] + out; n /= 58n; }
    for (const b of bytes) { if (b === 0) out = "1" + out; else break; }
    return out;
  };
})();

/** Everything for sealed duels. Holds no keys: callers pass the per-match signers. */
export class SealedClient {
  constructor(readonly game: GameClient, readonly teeHttp = TEE_HTTP, readonly teeWs = TEE_WS) {}
  private get programId() { return this.game.cfg.programId; }
  private m() { return this.game.anchor.methods as any; }
  duel(host: PublicKey) { return duelPda(host, this.programId); }
  pick(host: PublicKey, player: PublicKey) { return spickPda(this.duel(host), player, this.programId); }
  link(sig: string, layer: "base" | "tee") {
    return layer === "base" ? txLink(sig, "base", this.game.cfg) : `https://explorer.solana.com/tx/${sig}?cluster=custom&customUrl=${encodeURIComponent(this.teeHttp)}`;
  }

  // ------------------------------------------------------------------------------------------ TEE auth
  /** Signs the TEE challenge with the match key and returns a tokenized connection (HTTP + WS). */
  async connect(kp: Keypair, signMessage?: (m: Uint8Array) => Promise<Uint8Array>): Promise<TeeSession> {
    const nacl = (await import("tweetnacl")).default;
    const sign = signMessage ?? (async (m: Uint8Array) => nacl.sign.detached(m, kp.secretKey));
    const ch = await (await fetch(`${this.teeHttp}/auth/challenge?pubkey=${kp.publicKey.toBase58()}`)).json() as { challenge?: string; error?: string };
    if (!ch.challenge) throw new Error(`TEE challenge failed: ${ch.error ?? "no challenge"}`);
    const signature = b58(await sign(new TextEncoder().encode(ch.challenge)));
    const res = await fetch(`${this.teeHttp}/auth/login`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pubkey: kp.publicKey.toBase58(), challenge: ch.challenge, signature }),
    });
    const j = await res.json() as { token?: string; expiresAt?: number; error?: string };
    if (res.status !== 200 || !j.token) throw new Error(`TEE login failed: ${j.error ?? res.status}`);
    const exp = j.expiresAt ?? Date.now() + 30 * 24 * 3600 * 1000;
    const conn = new Connection(`${this.teeHttp}?token=${j.token}`, { wsEndpoint: `${this.teeWs}?token=${j.token}`, commitment: "confirmed" });
    return { conn, token: j.token, expiresAtMs: exp > 1e12 ? exp : exp * 1000 };
  }
  /** Public (token-less) TEE connection: reads public accounts and the permission status API. */
  publicTee() { return new Connection(this.teeHttp, { wsEndpoint: this.teeWs, commitment: "confirmed" }); }

  /**
   * Parses the EphemeralPermission account of `account` as stored on the TEE:
   * `disc u8 | bump u8 | permissioned account 32 | private u8 | members (flags u8 + pubkey 32) ...`.
   * This is the on-chain statement of who may read the account; the TEE enforces it.
   */
  async readPermission(conn: Connection, account: PublicKey): Promise<{ exists: boolean; isPrivate: boolean; members: string[] }> {
    const info = await conn.getAccountInfo(permissionPda(account)).catch(() => null);
    if (!info || info.data.length < 35) return { exists: false, isPrivate: false, members: [] };
    const d = info.data;
    const members: string[] = [];
    for (let o = 35; o + 33 <= d.length; o += 33) {
      const pk = new PublicKey(d.subarray(o + 1, o + 33));
      // the program itself is listed as a member of its own accounts; it is not a person
      if (!pk.equals(PublicKey.default) && !pk.equals(this.programId)) members.push(pk.toBase58());
    }
    return { exists: true, isPrivate: d[34] === 1, members };
  }

  // ------------------------------------------------------------------------------------------ reads
  decodeDuel(data: Buffer | Uint8Array): SealedDuelView {
    const d: any = this.game.anchor.coder.accounts.decode("sealedDuel", Buffer.from(data));
    return {
      status: d.status, players: [d.players[0].toBase58(), d.players[1].toBase58()], species: [d.species[0], d.species[1]],
      match: decodeMatch(d.state), lockedMask: d.lockedMask, lockSlot: Number(d.lockSlot), lockTs: Number(d.lockTs), progressTs: Number(d.progressTs),
      seed: Buffer.from(d.seed).toString("hex"), winner: d.winner,
      log: (d.log as any[]).slice(0, d.logLen).map((t) => ({ picks: [t.picks[0], t.picks[1]], nonces: [BigInt(t.nonces[0].toString()), BigInt(t.nonces[1].toString())], rnd: Array.from(t.rnd as number[]) })),
    };
  }
  async readDuel(host: PublicKey, via: "base" | Connection): Promise<SealedDuelView | null> {
    const conn = via === "base" ? this.game.base : via;
    const info = await conn.getAccountInfo(this.duel(host));
    if (!info) return null;
    try { return this.decodeDuel(info.data); } catch { return null; }
  }
  /** Reads a pick account as `conn`'s token holder. A non-member gets null: that is the privacy proof. */
  async peekPick(conn: Connection, host: PublicKey, player: PublicKey): Promise<{ visible: boolean; slot?: number; locked?: boolean }> {
    const info = await conn.getAccountInfo(this.pick(host, player)).catch(() => null);
    if (!info) return { visible: false };
    const p: any = this.game.anchor.coder.accounts.decode("sealedPick", Buffer.from(info.data));
    return { visible: true, slot: p.slot, locked: p.locked };
  }

  // ------------------------------------------------------------------------------------------ base layer
  static newToken(): Uint8Array { return crypto.getRandomValues(new Uint8Array(32)); }
  static tokenHash(token: Uint8Array): number[] { return Array.from(sha256(token)); }

  async create(signer: TxSigner, species: number, token: Uint8Array): Promise<SealedReceipt> {
    const host = signer.publicKey;
    const ix = await this.m().sCreate(host, species, SealedClient.tokenHash(token)).accounts({
      duel: this.duel(host), pick: this.pick(host, host), payer: host, systemProgram: SystemProgram.programId,
    }).instruction();
    return this.base_([ix], signer);
  }
  async join(signer: TxSigner, host: PublicKey, species: number, token: Uint8Array): Promise<SealedReceipt> {
    const guest = signer.publicKey;
    const ix = await this.m().sJoin(guest, species, Array.from(token)).accounts({
      duel: this.duel(host), pick: this.pick(host, guest), payer: guest, systemProgram: SystemProgram.programId,
    }).instruction();
    return this.base_([ix], signer);
  }
  async requestSeed(signer: TxSigner, host: PublicKey): Promise<SealedReceipt> {
    const ix = await this.m().sRequestSeed().accounts({ payer: signer.publicKey, duel: this.duel(host), oracleQueue: VRF_BASE_QUEUE }).instruction();
    return this.base_([ix], signer);
  }
  async waitSeeded(host: PublicKey, timeoutMs = 40_000): Promise<SealedDuelView> {
    return waitFor(async () => { const d = await this.readDuel(host, "base"); return d && d.status >= SEALED.SEEDED ? d : null; }, { timeoutMs, pollMs: 700, label: "VRF seed" });
  }
  /** One base transaction: delegate the duel and both picks to the TEE validator. */
  async delegateAll(signer: TxSigner, host: PublicKey, players: [PublicKey, PublicKey]): Promise<SealedReceipt> {
    const duel = this.duel(host);
    const del = async (account: any, pda: PublicKey) => this.m().sDelegate(account).accounts({ pda, duelView: duel, payer: signer.publicKey, validator: TEE_VALIDATOR }).instruction() as Promise<TransactionInstruction>;
    const ixs = [
      await del({ duel: { host } }, duel),
      await del({ pick: { duel, player: players[0] } }, this.pick(host, players[0])),
      await del({ pick: { duel, player: players[1] } }, this.pick(host, players[1])),
    ];
    return this.base_(ixs, signer);
  }
  async cancel(signer: TxSigner): Promise<SealedReceipt> {
    const host = signer.publicKey;
    const ix = await this.m().sCancel().accounts({ duel: this.duel(host), pick: this.pick(host, host), payer: host }).instruction();
    return this.base_([ix], signer);
  }
  /** Waits until the TEE has cloned the delegated accounts. */
  async waitCloned(tee: Connection, host: PublicKey, players: [PublicKey, PublicKey], timeoutMs = 45_000) {
    const keys = [this.duel(host), this.pick(host, players[0]), this.pick(host, players[1])];
    await waitFor(async () => { const r = await Promise.all(keys.map((k) => tee.getAccountInfo(k).catch(() => null))); return r.every(Boolean) ? true : null; }, { timeoutMs, pollMs: 250, label: "TEE clone" });
  }

  // ------------------------------------------------------------------------------------------ TEE
  async open(tee: Connection, signer: TxSigner, host: PublicKey, players: [PublicKey, PublicKey]): Promise<SealedReceipt> {
    const a = this.pick(host, players[0]), b = this.pick(host, players[1]);
    const ix = await this.m().sOpen().accounts({
      duel: this.duel(host), pickA: a, permissionA: permissionPda(a), pickB: b, permissionB: permissionPda(b),
      payer: signer.publicKey, permissionProgram: PERMISSION_PROGRAM, ephemeralVault: EPHEMERAL_VAULT, magicProgram: MAGIC_PROGRAM,
    }).instruction();
    return this.tee_(tee, [ix], signer);
  }
  /** Waits until both picks have a private permission on the TEE that lists only their owner. */
  async waitPermissions(conns: [Connection, Connection], host: PublicKey, players: [PublicKey, PublicKey], timeoutMs = 12_000): Promise<boolean> {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      // each owner reads its own permission with its own token (the permission account is access controlled too)
      const r = await Promise.all(players.map((p, i) => this.readPermission(conns[i], this.pick(host, p))));
      if (r.every((x, i) => x.exists && x.isPrivate && x.members.length === 1 && x.members[0] === players[i].toBase58())) return true;
      await sleep(300);
    }
    return false;
  }
  /** Seal a pick. `nonce` is the secret half of the roll: keep it, it only becomes public when the turn resolves. */
  async lock(tee: Connection, signer: TxSigner, host: PublicKey, slot: number, nonce: bigint): Promise<SealedReceipt> {
    const me = signer.publicKey;
    const pick = this.pick(host, me);
    const ix = await this.m().sLock(slot, new (await import("@coral-xyz/anchor")).BN(nonce.toString())).accounts({
      duel: this.duel(host), pick, permission: permissionPda(pick), player: me,
    }).instruction();
    return this.tee_(tee, [ix], signer);
  }
  async resolve(tee: Connection, signer: TxSigner, host: PublicKey, players: [PublicKey, PublicKey]): Promise<SealedReceipt> {
    const ix = await this.m().sResolve().accounts({
      duel: this.duel(host), pickA: this.pick(host, players[0]), pickB: this.pick(host, players[1]), payer: signer.publicKey,
    }).instruction();
    return this.tee_(tee, [ix], signer);
  }
  async timeout(tee: Connection, signer: TxSigner, host: PublicKey): Promise<SealedReceipt> {
    const ix = await this.m().sTimeout().accounts({ duel: this.duel(host), payer: signer.publicKey }).instruction();
    return this.tee_(tee, [ix], signer);
  }
  async finish(tee: Connection, signer: TxSigner, host: PublicKey, players: [PublicKey, PublicKey]): Promise<SealedReceipt> {
    const ix = await this.m().sFinish().accounts({
      payer: signer.publicKey, duel: this.duel(host), pickA: this.pick(host, players[0]), pickB: this.pick(host, players[1]),
    }).instruction();
    return this.tee_(tee, [ix], signer);
  }
  /** Waits for the finished duel to be committed to Solana (undelegated: owned by our program again). */
  async waitCommitted(host: PublicKey, timeoutMs = 45_000): Promise<SealedDuelView> {
    return waitFor(async () => {
      const info = await this.game.base.getAccountInfo(this.duel(host));
      if (!info || !info.owner.equals(this.programId)) return null;
      const d = this.decodeDuel(info.data);
      return d.status === SEALED.FINISHED ? d : null;
    }, { timeoutMs, pollMs: 800, label: "commit to Solana" });
  }

  // ------------------------------------------------------------------------------------------ plumbing
  private async base_(ixs: TransactionInstruction[], signer: TxSigner): Promise<SealedReceipt> {
    const r = await sendBase(this.game.base, ixs, signer);
    return { ...r, layer: "base", link: this.link(r.sig, "base") };
  }
  private async tee_(tee: Connection, ixs: TransactionInstruction[], signer: TxSigner): Promise<SealedReceipt> {
    const r = await sendEr(tee, ixs, signer);
    return { ...r, layer: "tee", link: this.link(r.sig, "tee") };
  }
}

export { keypairSigner };
void Transaction;
