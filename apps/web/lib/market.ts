'use client';

import { useEffect, useMemo, useState } from 'react';
import { ROUTES } from './routes';

/**
 * SIMULATED price feed for the offline build (P7 swaps this for the MagicBlock oracle). Deterministic random
 * walk per asset so the UI shows a live-looking price and arrow without any network.
 */
const BASE: Record<string, number> = { sol: 168.4, btc: 96200, eth: 3480, sui: 3.72, zec: 62.1, bnb: 612, doge: 0.186, xrp: 2.41 };

export interface PriceTick { price: number; /** percent change over the last ~hour (simulated) */ change: number }

const state: Record<string, PriceTick> = {};
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;

function seedState() {
  for (const r of ROUTES) if (!state[r.id]) state[r.id] = { price: BASE[r.id], change: 0 };
}

function step() {
  for (const r of ROUTES) {
    const s = state[r.id];
    const drift = (Math.random() - 0.5) * 0.0036;
    const price = s.price * (1 + drift);
    state[r.id] = { price, change: Math.max(-6, Math.min(6, s.change * 0.97 + drift * 100)) };
  }
  listeners.forEach((l) => l());
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
    if (!timer) timer = setInterval(step, 2500);
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
