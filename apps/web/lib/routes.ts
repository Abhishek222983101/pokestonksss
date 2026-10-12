
/** One globe pin per asset. Coordinates are chain-themed cities. */
export interface RouteDef {
  id: string;
  symbol: string;
  name: string;
  city: string;
  coordinates: [number, number];
  /** Art theme id (game/art/themes). */
  theme: string;
  /** Which BrokerMon owns the route. */
  brokerId: string;
  blurb: string;
}

export const ROUTES: RouteDef[] = [
  { id: 'sol', symbol: 'SOL', name: 'Validator Run', city: 'Lisbon', coordinates: [-9.139, 38.722], theme: 'sol', brokerId: 'sol', blurb: 'Server racks hum. Blocks land every 400ms.' },
  { id: 'btc', symbol: 'BTC', name: 'Genesis Mine', city: 'El Salvador', coordinates: [-88.897, 13.794], theme: 'btc', brokerId: 'btc', blurb: 'Rigs, drums and the first block ever.' },
  { id: 'eth', symbol: 'ETH', name: 'Obelisk Path', city: 'Zug', coordinates: [8.517, 47.166], theme: 'eth', brokerId: 'eth', blurb: 'Smart-contract monoliths hum with gas.' },
  { id: 'sui', symbol: 'SUI', name: 'Object Harbor', city: 'Singapore', coordinates: [103.82, 1.352], theme: 'sui', brokerId: 'sui', blurb: 'Crates of objects stack up on the pier.' },
  { id: 'zec', symbol: 'ZEC', name: 'Shielded Trail', city: 'Denver', coordinates: [-104.99, 39.739], theme: 'zec', brokerId: 'zec', blurb: 'Lamps glow, but nobody sees the trail.' },
  { id: 'bnb', symbol: 'BNB', name: 'Burn Boulevard', city: 'Dubai', coordinates: [55.296, 25.276], theme: 'bnb', brokerId: 'bnb', blurb: 'Golden exchange towers and a quarterly burn.' },
  { id: 'doge', symbol: 'DOGE', name: 'Moon Meadow', city: 'Tokyo', coordinates: [139.692, 35.69], theme: 'doge', brokerId: 'doge', blurb: 'Rockets, neon and a very good boy.' },
  { id: 'xrp', symbol: 'XRP', name: 'Ledger Pier', city: 'San Francisco', coordinates: [-122.419, 37.775], theme: 'xrp', brokerId: 'xrp', blurb: 'Cross-border crates, settled in seconds.' },
];

export const getRoute = (id: string): RouteDef | undefined => ROUTES.find((r) => r.id === id);
