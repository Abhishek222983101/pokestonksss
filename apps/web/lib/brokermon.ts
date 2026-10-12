import { TYPE_NAMES, type TypeId } from './rules';

/**
 * BrokerMon registry (ids 0-7, one per oracle asset). `sprite` points at one of the legacy procedural painters
 * in game/art/species/* and `colors` re-tints it; both are TEMPORARY until the species art rewrite lands - the
 * rest of the app only reads this registry, so replacing the art never touches UI code.
 */
export interface BrokerMon {
  /** Lower-case ticker, used as texture key suffix (`mon_sol_front`). */
  id: string;
  num: number;
  name: string;
  ticker: string;
  type: TypeId;
  /** Display name of the type ("Speed"). */
  typeLabel: string;
  sector: string;
  tagline: string;
  /** Legacy painter key (see art/mons.ts). */
  sprite: string;
  /** [primary, secondary] palette for the painter, UI portraits and the VS screen. */
  colors: [string, string];
  /** Route that is themed for this asset. */
  routeId: string;
}

const label = (t: TypeId) => TYPE_NAMES[t][0] + TYPE_NAMES[t].slice(1).toLowerCase();

const make = (num: number, id: string, name: string, type: TypeId, sector: string, tagline: string, sprite: string, colors: [string, string]): BrokerMon => ({
  id, num, name, ticker: id.toUpperCase(), type, typeLabel: label(type), sector, tagline, sprite, colors, routeId: id,
});

export const BROKERMON: BrokerMon[] = [
  make(0, 'sol', 'Solarc', 0, 'Layer 1', 'Fastest block in the pack. Blinks, you are liquidated.', 'tsla', ['#9945ff', '#14f195']),
  make(1, 'btc', 'Bitrock', 1, 'Store of value', 'Cold-forged. Never sells. Never bends.', 'aapl', ['#f7931a', '#4a3a28']),
  make(2, 'eth', 'Etherion', 2, 'Smart contracts', 'Casts spells in solidity. Burns gas for fun.', 'coin', ['#627eea', '#e8e6ff']),
  make(3, 'sui', 'Suiflow', 3, 'Layer 1', 'Rides every object like a wave.', 'amzn', ['#4da2ff', '#e8f6ff']),
  make(4, 'zec', 'Zecshade', 4, 'Privacy', 'You cannot see its moves. That is the point.', 'mstr', ['#f4b728', '#26222e']),
  make(5, 'bnb', 'Bnbull', 1, 'Exchange', 'Burns tokens. Charges anyway.', 'msft', ['#f3ba2f', '#2a2a30']),
  make(6, 'doge', 'Dogeon', 0, 'Meme', 'Much wow. Very fast. Such leverage.', 'gme', ['#c9a43c', '#7a5a22']),
  make(7, 'xrp', 'Ripplet', 3, 'Payments', 'Settles in three seconds, litigates in three years.', 'nke', ['#5a6a7a', '#a8d8ff']),
];

const BY_ID = new Map(BROKERMON.map((b) => [b.id, b]));

export const isBrokerId = (v: unknown): v is string => typeof v === 'string' && BY_ID.has(v);
export const getBroker = (id: string): BrokerMon => BY_ID.get(id) ?? BROKERMON[0];
export const brokerByNum = (n: number): BrokerMon => BROKERMON[n] ?? BROKERMON[0];
