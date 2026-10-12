/** Shared helpers for devnet scripts built on the SDK. */
import { Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { fundFromDeployer } from "./fund";
import { GameClient, devnetConfig, ensureReady, keypairSigner, type TxSigner, type OnboardEvent } from "@pokestonksss/sdk";

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function makeClient(region: "as" | "eu" | "us" = (process.env.REGION as "as") ?? "as") {
  return new GameClient(devnetConfig(region));
}

export async function airdrop(client: GameClient, pk: PublicKey, sol = 1): Promise<void> {
  try { if (await fundFromDeployer(client.base, pk, Math.round(Math.min(sol, 0.05) * LAMPORTS_PER_SOL))) return; } catch { /* fall through to public airdrop */ }
  for (let i = 0; i < 6; i++) {
    try {
      const sig = await client.base.requestAirdrop(pk, sol * LAMPORTS_PER_SOL);
      const bh = await client.base.getLatestBlockhash();
      await client.base.confirmTransaction({ signature: sig, ...bh }, "confirmed");
      return;
    } catch { await sleep(2500 * (i + 1)); }
  }
  throw new Error("devnet airdrop failed — set FAUCET_URL to a deployed /api/drip or fund " + pk.toBase58());
}

/** Drip via the deployed faucet route if FAUCET_URL is set, else the public devnet airdrop. */
export function dripper(client: GameClient) {
  return async (pk: string) => {
    const url = process.env.FAUCET_URL;
    if (url) {
      const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ pubkey: pk }) });
      if (!r.ok) throw new Error("faucet: " + (await r.text()));
      return;
    }
    await airdrop(client, new PublicKey(pk), 1);
  };
}

export async function newPlayer(client: GameClient, label = "guest", onEvent?: (e: OnboardEvent) => void) {
  const kp = Keypair.generate();
  const signer = keypairSigner(kp);
  const t0 = performance.now();
  await ensureReady({ client, signer, drip: dripper(client), onEvent: (e) => { onEvent?.(e); } });
  return { kp, signer, label, onboardMs: Math.round(performance.now() - t0) };
}

export async function waitArena(client: GameClient, host: PublicKey, pred: (a: any) => boolean, timeoutMs = 30_000, label = "arena condition") {
  const t0 = Date.now();
  for (;;) {
    const a = await client.getArena(host);
    if (a && pred(a)) return a;
    if (Date.now() - t0 > timeoutMs) throw new Error("timeout waiting for " + label);
    await sleep(60);
  }
}

export async function playPracticeToEnd(client: GameClient, signer: TxSigner, species: number, opp: number, tier = 1) {
  const host = signer.publicKey;
  const start = await client.startPractice(signer, species, opp, tier);
  const turns: { pick: number; lockMs: number; resolveMs: number; sig: string; link: string }[] = [];
  let a = await client.getArena(host);
  for (let g = 0; g < 40 && a && a.phase !== 5; g++) {
    const slot = Math.floor(Math.random() * 4);
    const t = performance.now();
    const r = await client.lockPick(signer, slot);
    const tl = performance.now();
    const turnNow = a.match.turn;
    a = await waitArena(client, host, (x) => x.match.turn > turnNow || x.phase === 5, 30_000, "VRF callback");
    turns.push({ pick: slot, lockMs: Math.round(tl - t), resolveMs: Math.round(performance.now() - tl), sig: r.sig, link: r.link });
  }
  return { start, turns, arena: a! };
}

export const stats = (a: number[]) => {
  if (!a.length) return { n: 0 };
  const s = [...a].sort((x, y) => x - y);
  return { n: s.length, p50: s[Math.floor(s.length / 2)], p95: s[Math.min(s.length - 1, Math.floor(s.length * 0.95))], max: s[s.length - 1] };
};
