import { Connection, PublicKey } from '@solana/web3.js';
import { FEEDS } from '@pokestonksss/sdk';

/** price (USD) from a raw oracle account: price i64 @73, exponent i32 @89 (+8 live), publish_time i64 @93. */
export function parsePriceUsd(data: Uint8Array): { usd: number; publishTime: number; raw: bigint } | null {
  if (data.length < 101) return null;
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const raw = dv.getBigInt64(73, true);
  const expo = dv.getInt32(89, true);
  const publishTime = Number(dv.getBigInt64(93, true));
  if (raw <= 0n || expo === 0 || Math.abs(expo) > 18) return null;
  return { usd: Number(raw) / Math.pow(10, Math.abs(expo)), publishTime, raw };
}

/** +1 / 0 / -1 vs the bell snapshot with a 1 bp dead-band (same rule as the program). */
export function moodOf(snap: bigint, nowRaw: bigint | null): -1 | 0 | 1 {
  if (!nowRaw || snap <= 0n) return 0;
  const diff = (nowRaw - snap) * 10000n;
  const band = snap;
  return diff > band ? 1 : diff < -band ? -1 : 0;
}

export type PriceCb = (p: { usd: number; raw: bigint; publishTime: number }) => void;

/** Live price of a species on the ER (websocket + 3 s poll fallback). */
export function watchPrice(er: Connection, species: number, cb: PriceCb): () => void {
  const feed: PublicKey = FEEDS[species];
  let stopped = false;
  const handle = (d: Uint8Array) => { const p = parsePriceUsd(d); if (p) cb(p); };
  let id: number | undefined;
  try { id = er.onAccountChange(feed, (i) => handle(i.data), 'confirmed'); } catch { /* poll only */ }
  (async () => {
    while (!stopped) {
      try { const i = await er.getAccountInfo(feed); if (i) handle(i.data); } catch { /* retry */ }
      await new Promise((r) => setTimeout(r, 3000));
    }
  })();
  return () => { stopped = true; if (id !== undefined) void er.removeAccountChangeListener(id).catch(() => {}); };
}
