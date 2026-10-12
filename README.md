# PokeStonksss

**Pokémon-Go-style battles where the rollup is the game server.** Pick a BrokerMon (one per crypto asset), walk a pixel route, and battle — every move runs on a **MagicBlock Ephemeral Rollup**, every dice roll is a **MagicBlock VRF** result you can verify, live **MagicBlock oracle** prices change the damage, and your rating is saved to Solana **with no claim button**. No game server, no database, no cold start.

> **Live demo: https://pokestonksss.vercel.app** · judge page: https://pokestonksss.vercel.app/judge
>
> Built for MagicBlock **Solana Blitz V9** (and Colosseum Crypto World's Fair). Devnet only, no real money.

## Verify it yourself in 60 seconds
1. Open the live app → **/judge** → press **Run self-test**. It plays a real battle on devnet from your browser (no wallet needed) and lists every transaction.
2. Open any link in the list: *delegation*, *start_practice on the ER*, each *lock_pick* (VRF request → callback), *commit to Solana*.
3. Open **/verify/<your arena>** to replay the match from on-chain data with the same Rust rules engine.
4. Read the program: [`programs/pokestonksss`](programs/pokestonksss) — program id in the table below.

## How MagicBlock is used (nothing decorative)
| Primitive | Job in the game | Where |
|---|---|---|
| **Ephemeral Rollup** | Trainer + Arena accounts are delegated at onboarding; every battle tx runs on the ER (no wallet popups, no server) | `delegate_all`, all ER instructions |
| **VRF** | One roll per turn, requested **only after both picks are locked** (no peeking, no simulation tricks); callback resolves the turn | `lock_pick` / `reveal_pick` → `callback_turn` |
| **Real-time oracle** | Price move since the bell → ±10% damage "market mood" (best-effort, flat if stale) | `oracle.rs` |
| **Commit to Solana** | Rating/dex are committed from the ER ("Saved ✓"), batched under the 10-commit cap | `commit_trainer`, `save_and_leave` |
| **Sealed picks** | Duels use commit-reveal (sha256) so neither side sees the other's move early | `commit_pick` / `reveal_pick` |

## Architecture
```
Browser (Next.js 16 + Phaser)  ──base tx──►  Solana devnet (program, delegation)
        │                                         │ delegate / commit
        └────ER tx + websocket────►  MagicBlock ER (Asia) ── VRF oracle · price oracle
```
- `programs/pokestonksss` — Anchor program (Rust). `crates/duel-rules` — deterministic integer rules shared by the program, the browser (WASM) and tests.
- `packages/sdk` — typed TS client. `apps/web` — the game (ported engine + new UI). `scripts/` — devnet e2e, load test, deploy.
- Full docs: [`docs/SYSTEM-ARCHITECTURE.md`](docs/SYSTEM-ARCHITECTURE.md), [`docs/BUILD-PLAN.md`](docs/BUILD-PLAN.md), [`docs/OVERVIEW.md`](docs/OVERVIEW.md), [`docs/RULES.md`](docs/RULES.md).

## Program / feeds (devnet)
| | |
|---|---|
| Program | `FRxAb7Nw1GFyLkV7KN7fitTztiZuJ1y1oNEmcW3mHM1M` |
| ER validator (Asia) | `MAS1Dt9qreoRMQ14YQuhg8UTZMMzDdKhmkZMECCzk57` |
| Delegation program | `DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh` |
| Oracle program | `PriCems5tHihc6UDXDjzjeawomAwBduWMGAi8ZUjppd` |

## Run locally
```bash
pnpm install
cargo test -p duel-rules --release && cargo test -p pokestonksss --lib
pnpm --filter web dev            # game on http://localhost:3000
pnpm --filter scripts e2e:practice   # devnet end-to-end
```
Deploy (you run it; keys never go through tooling): `scripts/deploy-devnet.sh pokestonksss`.

## Prior work disclosure
The game engine and UI foundations (Phaser world, procedural art/audio engine, battle widgets) are reused from our earlier Monad hackathon prototype **PokeStonks**. Everything on Solana/MagicBlock — the on-chain program, rules engine, oracle/VRF integration, SDK, onboarding, duels, proof pages, creatures and UX — was built for this hackathon.
