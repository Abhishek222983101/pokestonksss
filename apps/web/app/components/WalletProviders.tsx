'use client';

import { WalletProvider } from '@solana/wallet-adapter-react';

/** Wallet Standard discovery: Phantom, Solflare, Backpack and any other installed Solana wallet show up on their own. */
export default function WalletProviders({ children }: { children: React.ReactNode }) {
  return <WalletProvider wallets={[]} autoConnect={false}>{children}</WalletProvider>;
}
