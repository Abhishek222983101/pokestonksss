import type { ChainConfig } from "./config";

export const txLink = (sig: string, layer: "base" | "er", cfg: Pick<ChainConfig, "erHttp">) =>
  layer === "base"
    ? `https://explorer.solana.com/tx/${sig}?cluster=devnet`
    : `https://explorer.solana.com/tx/${sig}?cluster=custom&customUrl=${encodeURIComponent(cfg.erHttp)}`;

export const accountLink = (addr: string, layer: "base" | "er", cfg: Pick<ChainConfig, "erHttp">) =>
  layer === "base"
    ? `https://explorer.solana.com/address/${addr}?cluster=devnet`
    : `https://explorer.solana.com/address/${addr}?cluster=custom&customUrl=${encodeURIComponent(cfg.erHttp)}`;
