import { PublicKey } from "@solana/web3.js";
import idl from "./idl/pokestonksss.json";

export const PROGRAM_ID = new PublicKey((idl as { address: string }).address);

/** ER validator identities (same on devnet and mainnet). */
export const VALIDATORS = {
  as: new PublicKey("MAS1Dt9qreoRMQ14YQuhg8UTZMMzDdKhmkZMECCzk57"),
  eu: new PublicKey("MEUGGrYPxKk17hCr7wpT6s8dtNokZj5U2L57vjYMS8e"),
  us: new PublicKey("MUS3hc9TCw4cGC12vHNoYcCGzJG1txjgQLZWVoeNHNd"),
} as const;

/** Delegated (ER) VRF queue, same on devnet + mainnet. */
export const ER_VRF_QUEUE = new PublicKey("5hBR571xnXppuCPveTrctfTU7tJLSN94nq7kv7FRK5Tc");

/** Oracle price feed accounts per BrokerMon species id 0..7 (SOL BTC ETH SUI ZEC BNB DOGE XRP). */
export const FEEDS = [
  "ENYwebBThHzmzwPLAQvCucUTsjyfBSZdD9ViXksS4jPu",
  "71wtTRDY8Gxgw56bXFt2oc6qeAbTxzStdNiC425Z51sr",
  "5vaYr1hpv8yrSpu8w3K95x22byYxUJCCNCSYJtqVWPvG",
  "5WLZBMYdJ9PyNLEVxUumz9XZ11446L6dEPHGkPGehJ2j",
  "6XWQr2Y1XEpJrCdVbYGupnDeb3wkR4YXazVXdgn2Lwpg",
  "BYcDWZKZcGo8y3252xkK9ZrLoRoeMFaixWD6SoeW12fs",
  "Gi5NTTpv9bzBQTgjKyqczJPtSbH1ojebLFgRrP3JKZYZ",
  "6ghNHfjf5YP1aKtpAfdHK1KrtKEm5Ww6SaDffDTxf5xX",
].map((s) => new PublicKey(s));

export interface ChainConfig {
  baseHttp: string;
  erHttp: string;
  erWs: string;
  validator: PublicKey;
  programId: PublicKey;
  /** min balance (lamports) a guest should hold before onboarding */
  minBalance: number;
}

export type Region = "as" | "eu" | "us";

export function devnetConfig(region: Region = "as", over: Partial<ChainConfig> = {}): ChainConfig {
  return {
    baseHttp: "https://rpc.magicblock.app/devnet",
    erHttp: `https://devnet-${region}.magicblock.app`,
    erWs: `wss://devnet-${region}.magicblock.app`,
    validator: VALIDATORS[region],
    programId: PROGRAM_ID,
    minBalance: 20_000_000,
    ...over,
  };
}
