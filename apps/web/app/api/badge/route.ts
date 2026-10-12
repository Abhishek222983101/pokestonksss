import { Connection, Keypair, PublicKey, Transaction } from "@solana/web3.js";
import { GameClient, claimPda, devnetConfig } from "@pokestonksss/sdk";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RPC = process.env.FAUCET_RPC ?? process.env.NEXT_PUBLIC_BASE_RPC ?? "https://rpc.magicblock.app/devnet";
const FLOOR = Number(process.env.FAUCET_FLOOR_LAMPORTS ?? 500_000_000);
const MAX_PER_OWNER_HOUR = 24;
const HOUR = 3_600_000;
const byOwner = new Map<string, number[]>();

function relayer(): Keypair | null {
  const raw = process.env.FAUCET_SECRET_KEY;
  if (!raw) return null;
  try { return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw))); } catch { return null; }
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

/**
 * Badge relayer. `mint_badge` is permissionless and checks the owner's committed Trainer on chain, so this route only
 * pays the fee and rent. It cannot mint anything the program would not mint for anyone else.
 */
export async function POST(req: Request) {
  const kp = relayer();
  if (!kp) return json({ error: "badge relayer not configured" }, 503);
  let owner: PublicKey; let id: number;
  try {
    const b = (await req.json()) as { owner?: string; id?: number };
    owner = new PublicKey(b.owner ?? "");
    id = Number(b.id);
    if (!Number.isInteger(id) || id < 0 || id > 15) throw new Error("bad id");
  } catch { return json({ error: "invalid request" }, 400); }

  const now = Date.now();
  const key = owner.toBase58();
  const hits = (byOwner.get(key) ?? []).filter((t) => now - t < HOUR);
  if (hits.length >= MAX_PER_OWNER_HOUR) return json({ error: "rate limited, try again later" }, 429);

  const client = new GameClient(devnetConfig("as", { baseHttp: RPC }));
  const conn = new Connection(RPC, "confirmed");
  try {
    if (await conn.getAccountInfo(claimPda(owner, id, client.cfg.programId))) return json({ ok: true, already: true });
    if ((await conn.getBalance(kp.publicKey)) < FLOOR) return json({ error: "relayer is low on devnet SOL, please try again soon" }, 503);
    const ix = await client.mintBadgeIx(kp.publicKey, owner, id);
    const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
    const tx = new Transaction({ feePayer: kp.publicKey, blockhash, lastValidBlockHeight }).add(ix);
    tx.sign(kp);
    const sig = await conn.sendRawTransaction(tx.serialize());
    await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
    hits.push(now); byOwner.set(key, hits);
    return json({ ok: true, sig });
  } catch (e) {
    const m = String((e as Error).message);
    if (/6\d{3}|BadgeNotEarned|not earned/i.test(m)) return json({ error: "not earned yet: save your progress to Solana first" }, 409);
    return json({ error: "mint failed: " + m.slice(0, 140) }, 502);
  }
}
