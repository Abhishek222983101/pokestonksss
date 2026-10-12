import { GameClient, devnetConfig, type Region } from '@pokestonksss/sdk';

let client: GameClient | null = null;

/** Single shared chain client (browser). Region/RPC are overridable via NEXT_PUBLIC_* for deploys. */
export function getClient(): GameClient {
  if (client) return client;
  const region = (process.env.NEXT_PUBLIC_ER_REGION as Region | undefined) ?? 'as';
  const over: Record<string, string> = {};
  if (process.env.NEXT_PUBLIC_BASE_RPC) over.baseHttp = process.env.NEXT_PUBLIC_BASE_RPC;
  if (process.env.NEXT_PUBLIC_ER_HTTP) over.erHttp = process.env.NEXT_PUBLIC_ER_HTTP;
  if (process.env.NEXT_PUBLIC_ER_WS) over.erWs = process.env.NEXT_PUBLIC_ER_WS;
  client = new GameClient(devnetConfig(region, over));
  return client;
}

export const FAUCET_URL = '/api/drip';
