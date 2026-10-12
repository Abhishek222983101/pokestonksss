import { PublicKey } from "@solana/web3.js";

/** ER validator identities (same on devnet and mainnet). Put one in remaining_accounts[0] of `delegate`. */
export const VALIDATORS = {
  as: new PublicKey("MAS1Dt9qreoRMQ14YQuhg8UTZMMzDdKhmkZMECCzk57"),
  eu: new PublicKey("MEUGGrYPxKk17hCr7wpT6s8dtNokZj5U2L57vjYMS8e"),
  us: new PublicKey("MUS3hc9TCw4cGC12vHNoYcCGzJG1txjgQLZWVoeNHNd"),
  tee: new PublicKey("MTEWGuqxUpYZGFJQcp8tLN7x5v9BSeoFHYWQQ3n3xzo"),
  local: new PublicKey("mAGicPQYBMvcYveUZA5F5UNNwyHvfYh5xkLS2Fr1mev"),
} as const;

export const PROGRAMS = {
  delegation: new PublicKey("DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh"),
  magic: new PublicKey("Magic11111111111111111111111111111111111111"),
  magicContext: new PublicKey("MagicContext1111111111111111111111111111111"),
  vrf: new PublicKey("Vrf1RNUjXmQGjmQrQLvJHs9SNkvDJEsRVFPkfSQUwGz"),
  sessionKeys: new PublicKey("KeyspM2ssCJbqUhQ4k7sveSiY4WjnYsrXkC8oDbwde5"),
  /** the validator's crank program id; crank signer PDA = ["crank-executor", task authority] under it */
  crank: new PublicKey("Crank11111111111111111111111111111111111111"),
} as const;

export const VRF_QUEUES = {
  base: new PublicKey("Cuj97ggrhhidhbu39TijNVqE74xvKJ69gDervRUXAxGh"), // DEFAULT_QUEUE       (devnet+mainnet)
  er: new PublicKey("5hBR571xnXppuCPveTrctfTU7tJLSN94nq7kv7FRK5Tc"), //   DEFAULT_EPHEMERAL_QUEUE (devnet+mainnet)
  baseLocal: new PublicKey("GKE6d7iv8kCBrsxr78W3xVdjGLLLJnxsGiuzrsZCGEvb"), // DEFAULT_TEST_QUEUE
  erLocal: new PublicKey("Sc9MJUngNbQXSXGP3F67KvKwVnhaYn6kcioxXNVowYT"), //  DEFAULT_EPHEMERAL_TEST_QUEUE
} as const;

export interface NetConfig {
  name: string;
  /** base-layer RPC (initialize, delegate, session creation, reading final state) */
  base: string;
  baseWs: string;
  /** ER RPC (everything that writes a delegated account) */
  er: string;
  erWs: string;
  /** Magic Router (optional): auto-routes by writable-account delegation status */
  router?: string;
  routerWs?: string;
  validator: PublicKey;
  baseQueue: PublicKey;
  erQueue: PublicKey;
}

export type Region = "as" | "eu" | "us";

export function devnet(region: Region = "us"): NetConfig {
  return {
    name: `devnet-${region}`,
    base: process.env.SOLANA_RPC_ENDPOINT ?? "https://rpc.magicblock.app/devnet",
    baseWs: process.env.SOLANA_WS_ENDPOINT ?? "wss://rpc.magicblock.app/devnet",
    er: `https://devnet-${region}.magicblock.app`,
    erWs: `wss://devnet-${region}.magicblock.app`,
    router: "https://devnet-router.magicblock.app",
    routerWs: "wss://devnet-router.magicblock.app",
    validator: VALIDATORS[region],
    baseQueue: VRF_QUEUES.base,
    erQueue: VRF_QUEUES.er,
  };
}

export function local(): NetConfig {
  return {
    name: "local",
    base: "http://127.0.0.1:8899",
    baseWs: "ws://127.0.0.1:8900",
    er: process.env.EPHEMERAL_PROVIDER_ENDPOINT ?? "http://127.0.0.1:7799",
    erWs: process.env.EPHEMERAL_WS_ENDPOINT ?? "ws://127.0.0.1:7800",
    validator: VALIDATORS.local,
    baseQueue: VRF_QUEUES.baseLocal,
    erQueue: VRF_QUEUES.erLocal,
  };
}

export function fromEnv(): NetConfig {
  const n = process.env.NET ?? "local";
  if (n === "local") return local();
  if (n.startsWith("devnet")) return devnet((n.split("-")[1] as Region) ?? "us");
  throw new Error(`unknown NET=${n}`);
}
