'use client';

import { useMemo } from 'react';
import { usePrices } from '../../lib/market';
import { ROUTES } from '../../lib/routes';

export type Mood = 'bull' | 'bear' | 'flat';

export interface RouteProps {
  id: string;
  symbol: string;
  name: string;
  city: string;
  theme: string;
  brokerId: string;
  blurb: string;
  price: number;
  /** Simulated hourly move in percent (the oracle replaces this in P7). */
  pct: number;
  mood: Mood;
}

export interface RouteFeature {
  id: string;
  geometry: { type: 'Point'; coordinates: [number, number] };
  properties: RouteProps;
}

/** The 8 globe routes with the (simulated, offline) price and mood attached. */
export function useRouteFeatures(): RouteFeature[] {
  const prices = usePrices();
  return useMemo(
    () =>
      ROUTES.map((r) => {
        const p = prices[r.id];
        const mood: Mood = p.change > 0.15 ? 'bull' : p.change < -0.15 ? 'bear' : 'flat';
        return {
          id: r.id,
          geometry: { type: 'Point' as const, coordinates: r.coordinates },
          properties: { id: r.id, symbol: r.symbol, name: r.name, city: r.city, theme: r.theme, brokerId: r.brokerId, blurb: r.blurb, price: p.price, pct: p.change, mood },
        };
      }),
    [prices],
  );
}
