# PROOFS: how to verify each claim

Everything below is on Solana devnet and the MagicBlock devnet rollups. Program: `FRxAb7Nw1GFyLkV7KN7fitTztiZuJ1y1oNEmcW3mHM1M`.

| Claim | How to verify | Automated evidence |
|---|---|---|
| Moves run on an Ephemeral Rollup in about 250 ms with no popups | Open **Proof** in any battle: every `lock_pick` links to the rollup explorer; latency is measured in the strip | `scripts/e2e-practice.ts`: lock p50 about 220 ms, VRF to resolved about 70 ms |
| Each roll is a MagicBlock VRF result requested after both picks lock | **Proof > VRF**: tx link plus the 10 random bytes of every turn; `/verify/<arena>` replays the match from them | replay equals chain state (`REPLAY_matches_chain`) |
| Live oracle prices change damage | **Proof > ORACLE**: bell price, current price, mood | `oracle.rs`, live price feed accounts linked in the panel |
| A wallet approves once, a session key signs everything | Connect a wallet, play, count wallet popups (one). **Proof > SESSION** shows the session signer and token account | `scripts/e2e-wallet.ts`: one `signTransaction` call for create + delegate + session key, zero during the battle |
| Levels, XP and evolutions are computed on chain | **Rewards** panel; the same Rust rules run in the browser (WASM) and in the program | `docs/evidence/e2e-v2.txt` (xp 120 = Lv 4), 64 Rust tests, 15 WASM tests |
| Wins mint badge tokens to your wallet | **Rewards** panel links each mint account and mint transaction; token appears in the wallet | `docs/evidence/e2e-v2.txt`, `scripts/e2e-wallet.ts` (First Blood balance 1) |
| A crank settles abandoned duels | `arm_timer` receipt in **Proof > CRANK** | `docs/evidence/e2e-v2.txt`: duel settled by the validator's task scheduler 63 s later |
| Private ER: nobody can read a sealed pick | Start a **Private duel**, open **Proof > PEEK PROOF**, press the button | `docs/evidence/e2e-sealed.txt`: host reads its own pick, host and guest cannot read each other's, an anonymous visitor and an authenticated stranger get null |
| Private ER permissions are derived on chain | **Proof > PERMISSION** links the permission account on the TEE; members list only the owner's match key | `e2e-sealed.ts` reads both permission accounts |
| Private duel rolls cannot be predicted or ground | `/verify/sealed/<match key>` recomputes every roll from the VRF seed and both sealed nonces | `e2e-sealed.ts`: every roll recomputes, the replay matches |
| Private duel result is on Solana | Final duel account is owned by our program again with the full log | `e2e-sealed.ts` waits for undelegation and decodes it |
| Attacks are rejected | 8 attacks on devnet (wrong seat, forged VRF callback, stranger session key, wrong token, spectator commit, early timeout, bad reveal...) | `scripts/e2e-security.ts`, `scripts/e2e-duel.ts` |

One click: **/judge > Run Private ER self-test** plays a whole sealed duel, runs the peek proofs and checks the committed result (`pnpm --filter scripts e2e:judgeprivate` does it in a real browser).

## Re-run
```bash
pnpm --filter scripts e2e:practice && pnpm --filter scripts e2e:duel && pnpm --filter scripts e2e:security
pnpm --filter scripts e2e:v2 && pnpm --filter scripts e2e:sealed
BASE_URL=https://pokestonksss.vercel.app MODE=private pnpm --filter scripts e2e:duelbrowser   # two real browsers, Private ER
```

## Private duel timings (devnet, measured by `e2e-sealed.ts`)
create 0.8 s, join 1.2 s, VRF seed 1 s, delegate to the TEE 1 s, TEE login 0.5 s, clone 0.3 s, open (permissions) 0.5 s: about 7 s from invite to a live private duel. About 1 s per sealed turn (two locks plus a resolve).
