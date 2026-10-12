import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DRIP = Number(process.env.DRIP_LAMPORTS ?? 30_000_000);
const FLOOR = Number(process.env.FAUCET_FLOOR_LAMPORTS ?? 500_000_000);
const MAX_PER_IP_HOUR = Number(process.env.DRIP_MAX_PER_IP_PER_HOUR ?? 6);
const RPC = process.env.FAUCET_RPC ?? process.env.NEXT_PUBLIC_BASE_RPC ?? "https://rpc.magicblock.app/devnet";
const HOUR = 3_600_000;

// Best-effort in-memory limits (per serverless instance). The balance floor is the hard stop.
const byIp = new Map<string, number[]>();
const byKey = new Map<string, number>();

function faucetKeypair(): Keypair | null {
  const raw = process.env.FAUCET_SECRET_KEY;
  if (!raw) return null;
  try { return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw))); } catch { return null; }
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
}

export async function POST(req: Request) {
  const kp = faucetKeypair();
  if (!kp) return json({ error: "faucet not configured" }, 503);
  let pubkey: PublicKey;
  try { pubkey = new PublicKey(((await req.json()) as { pubkey?: string }).pubkey ?? ""); }
  catch { return json({ error: "invalid pubkey" }, 400); }

  const ip = (req.headers.get("x-forwarded-for") ?? "local").split(",")[0].trim();
  const now = Date.now();
  const hits = (byIp.get(ip) ?? []).filter((t) => now - t < HOUR);
  if (hits.length >= MAX_PER_IP_HOUR) return json({ error: "rate limited, try again later" }, 429);
  const key = pubkey.toBase58();
  if (now - (byKey.get(key) ?? 0) < 60_000) return json({ error: "slow down" }, 429);

  const conn = new Connection(RPC, "confirmed");
  try {
    const have = await conn.getBalance(pubkey);
    if (have >= DRIP * 0.66) return json({ ok: true, skipped: true });
    const bal = await conn.getBalance(kp.publicKey);
    if (bal - DRIP < FLOOR) return json({ error: "faucet is low on devnet SOL, please try again soon" }, 503);
    const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
    const tx = new Transaction({ feePayer: kp.publicKey, blockhash, lastValidBlockHeight }).add(
      SystemProgram.transfer({ fromPubkey: kp.publicKey, toPubkey: pubkey, lamports: DRIP }),
    );
    tx.sign(kp);
    const sig = await conn.sendRawTransaction(tx.serialize());
    await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
    hits.push(now); byIp.set(ip, hits); byKey.set(key, now);
    return json({ ok: true, sig, sol: DRIP / LAMPORTS_PER_SOL });
  } catch (e) {
    // A slow confirmation can still have landed: report success if the recipient was funded.
    try { if ((await conn.getBalance(pubkey)) >= DRIP * 0.66) { byKey.set(key, now); return json({ ok: true, late: true }); } } catch { /* fall through */ }
    return json({ error: "faucet transfer failed: " + String((e as Error).message).slice(0, 120) }, 502);
  }
}

export async function GET() {
  const kp = faucetKeypair();
  if (!kp) return json({ configured: false });
  try {
    const bal = await new Connection(RPC, "confirmed").getBalance(kp.publicKey);
    return json({ configured: true, address: kp.publicKey.toBase58(), balanceSol: bal / LAMPORTS_PER_SOL, drips: Math.max(0, Math.floor((bal - FLOOR) / DRIP)) });
  } catch { return json({ configured: true, address: kp.publicKey.toBase58() }); }
}
