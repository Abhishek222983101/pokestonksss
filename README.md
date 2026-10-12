# PokeStonksss

**A crypto creature battler where the rollup is the game server.** Pick a BrokerMon (one per crypto asset), walk a pixel route and battle. Every move is a transaction on a **MagicBlock Ephemeral Rollup**, every dice roll is a **MagicBlock VRF** result you can verify, live **MagicBlock oracle** prices change the damage, a wallet-approved **session key** signs your moves so nothing pops up mid fight, a **crank** settles abandoned duels, and 1v1 duels can run inside a **Private Ephemeral Rollup (TEE)** where your pick is unreadable to everyone, including your opponent. Winning levels up and evolves your BrokerMon and mints badge tokens to your wallet. No game server, no database, no cold start.

> **Live: https://pokestonksss.vercel.app** · judge page: https://pokestonksss.vercel.app/judge · **judge demo (win in a few turns): https://pokestonksss.vercel.app/?demo=1**
>
> Built for MagicBlock **Solana Blitz V9** and Colosseum Crypto World's Fair. Devnet only, no real money.

## Verify it yourself in 60 seconds
1. Open **/?demo=1**, play as a guest (or connect a wallet), walk into tall grass. You face a Dummy House Agent that never attacks, so any attack wins. Open **Proof** in the battle and follow every link: delegation, rollup moves, VRF rolls, oracle weigh in, commit to Solana, session key, badge mint.
2. Open **/judge** and press **Run self-test**: it plays a real battle from your browser and lists every transaction.
3. **Private ER:** press **Duel a friend** (Private duel is the default), open the invite link in a second browser, and play. In **Proof** press **Peek at my opponent**: reading their sealed pick returns nothing, with your own login and with none.
4. Open **/verify/<arena>** or **/verify/sealed/<match key>** to replay any match from on-chain data with the same Rust rules.
5. Read the program: [`programs/pokestonksss`](programs/pokestonksss).

## How MagicBlock is used (nothing decorative)
| Primitive | Job in the game | Where |
|---|---|---|
| **Ephemeral Rollup** | Trainer + Arena accounts are delegated at onboarding; every battle transaction runs on the rollup (about 250 ms, no server) | `delegate_all`, all rollup instructions |
| **Private Ephemeral Rollup (TEE)** | Sealed 1v1 duels: each pick lives in an account whose permission lists only its owner's one-time match key; the opponent, spectators and anonymous readers get nothing back | `sealed.rs`: `s_open`, `s_lock`, `s_resolve`, `s_finish` |
| **VRF** | One roll per turn, requested only after both picks are locked (practice and rollup duels). Private duels use a base-layer VRF seed mixed with both sealed nonces | `lock_pick` / `reveal_pick` → `callback_turn`, `s_request_seed` → `s_consume_seed` |
| **Real-time oracle** | Price move since the bell changes damage by ±10% (best effort, flat if stale) | `oracle.rs` |
| **Session keys** | One wallet approval creates the Trainer, delegates it and registers a session key; the key signs every move, so no popups in a fight | `session_auth_or` on every player instruction |
| **Crank** | A task scheduled with `ScheduleTask` settles a duel a player walked away from, with nobody calling anything | `arm_timer`, `crank_timeout` |
| **Commit to Solana** | Rating, XP and dex are committed from the rollup and drive badge mints; private duels commit and undelegate at the end | `commit_trainer`, `s_finish` |

## Rewards
Wins add XP to the BrokerMon you fought with. Levels give +4% stats and BrokerMons **evolve at Lv 4 and Lv 7** (new names, bigger sprites, glow). Eight **badge tokens** (real SPL tokens) are minted to your wallet from your committed Trainer, with no claim button: First Blood, Regular, Collector, Dolphin, Shark, Evolved, Apex, Hot Streak. Guests receive them on their guest key and can connect a wallet later.

## Architecture
```
Browser (Next.js 16 + Phaser)  ──base tx──►  Solana devnet (program, delegation, VRF seed, badge mints)
        │                                         │ delegate / commit
        ├────ER tx + websocket────►  MagicBlock ER (Asia) ── VRF oracle · price oracle · crank
        └────TEE tx (auth token)──►  MagicBlock Private ER (Intel TDX) ── permissions · sealed picks
```
- `programs/pokestonksss` Anchor program (Rust), one program for every mode. `crates/duel-rules` deterministic integer rules shared by the program, the browser (WASM) and the tests.
- `packages/sdk` typed TS client (`GameClient`, `SealedClient`). `apps/web` the game and proof pages. `scripts/` devnet end to end tests, load test, deploy.
- Evidence of every claim: [`docs/PROOFS.md`](docs/PROOFS.md). Design docs: [`docs/SYSTEM-ARCHITECTURE.md`](docs/SYSTEM-ARCHITECTURE.md), [`docs/RULES.md`](docs/RULES.md).

## Program / feeds (devnet)
| | |
|---|---|
| Program | `FRxAb7Nw1GFyLkV7KN7fitTztiZuJ1y1oNEmcW3mHM1M` |
| ER validator (Asia) | `MAS1Dt9qreoRMQ14YQuhg8UTZMMzDdKhmkZMECCzk57` |
| Private ER (TEE) validator | `MTEWGuqxUpYZGFJQcp8tLN7x5v9BSeoFHYWQQ3n3xzo` (`https://devnet-tee.magicblock.app`) |
| Permission program | `ACLseoPoyC3cBqoUtkbjZ4aDrkurZW86v19pXz2XQnp1` |
| Session keys program | `KeyspM2ssCJbqUhQ4k7sveSiY4WjnYsrXkC8oDbwde5` |
| Delegation program | `DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh` |
| Oracle program | `PriCems5tHihc6UDXDjzjeawomAwBduWMGAi8ZUjppd` |

## Run locally
```bash
pnpm install
cargo test --workspace --release
pnpm --filter web dev                 # game on http://localhost:3000
pnpm --filter scripts e2e:practice    # devnet: practice battle on the rollup
pnpm --filter scripts e2e:v2          # devnet: session keys, levels, badge tokens, crank
pnpm --filter scripts e2e:sealed      # devnet: Private ER sealed duel end to end
```
Deploy (you run it; keys never go through tooling): `scripts/deploy-devnet.sh pokestonksss`.

## Prior work disclosure
The game engine and UI foundations (Phaser world, procedural art and audio engine, battle widgets) are reused from our earlier Monad hackathon prototype **PokeStonks**. Everything on Solana and MagicBlock (the on-chain program, rules engine, rollup, VRF, oracle, session key, crank and Private ER integration, SDK, onboarding, duels, rewards, proof pages, creatures and UX) was built for this hackathon.
