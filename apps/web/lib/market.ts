'use client';

import { useEffect, useMemo, useState } from 'react';
import { ROUTES } from './routes';
import { FEEDS } from '@pokestonksss/sdk';
import { getClient } from './chain/config';
import { parsePriceUsd } from './chain/oracle';

/**
 * REAL prices from MagicBlock's on-rollup pricing oracle (Pyth Lazer feeds), read every 3 s from the ER.
 * `change` = % move since this page was opened. The BASE values below are only placeholders for the first ~1 s
 * (and when the rollup is unreachable the last real value is kept).
 */
const BASE: Record<string, number> = { sol: 168.4, btc: 96200, eth: 3480, sui: 3.72, zec: 62.1, bnb: 612, doge: 0.186, xrp: 2.41 };

export interface PriceTick { price: number; /** percent change over the last ~hour (simulated) */ change: number }

const state: Record<string, PriceTick> = {};
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;

function seedState() {
  for (const r of ROUTES) if (!state[r.id]) state[r.id] = { price: BASE[r.id], change: 0 };
}

const first: Record<string, number> = {};
let inflight = false;

async function step() {
  if (inflight) return;
  inflight = true;
  try {
    const infos = await getClient().er.getMultipleAccountsInfo(FEEDS, 'confirmed');
    ROUTES.forEach((r, i) => {
      const info = infos[i];
      const p = info ? parsePriceUsd(info.data) : null;
      if (!p) return;
      first[r.id] ??= p.usd;
      state[r.id] = { price: p.usd, change: ((p.usd - first[r.id]) / first[r.id]) * 100 };
    });
    listeners.forEach((l) => l());
  } catch { /* keep last values */ } finally { inflight = false; }
}

export function getPrice(id: string): PriceTick {
  seedState();
  return state[id] ?? { price: 0, change: 0 };
}

/** Subscribe to simulated ticks (shared timer). */
export function usePrices(): Record<string, PriceTick> {
  const [version, force] = useState(0);
  useEffect(() => {
    seedState();
    const l = () => force((n) => n + 1);
    listeners.add(l);
    if (!timer) { void step(); timer = setInterval(() => void step(), 3000); }
    return () => {
      listeners.delete(l);
      if (listeners.size === 0 && timer) { clearInterval(timer); timer = null; }
    };
  }, []);
  seedState();
  // A fresh object per tick so memoised consumers update.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => ({ ...state }), [version]);
}

export function formatPrice(p: number): string {
  if (p >= 1000) return `$${p.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
  if (p >= 10) return `$${p.toFixed(2)}`;
  return `$${p.toFixed(3)}`;
}

export const arrow = (c: number) => (c > 0.05 ? '▲' : c < -0.05 ? '▼' : '■');
