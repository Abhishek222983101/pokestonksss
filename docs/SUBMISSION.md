# Submission copy (ready to paste)

**Project name:** PokeStonksss
**One-liner:** Pokémon-Go-style battles where MagicBlock's rollup is the game server: instant, provably fair, no claim button.
**Live:** https://pokestonksss.vercel.app · Judge self-test: https://pokestonksss.vercel.app/judge · Repo: https://github.com/Abhishek222983101/pokestonksss
**Program (devnet):** FRxAb7Nw1GFyLkV7KN7fitTztiZuJ1y1oNEmcW3mHM1M · **Categories:** Games, Consumer · **Integration proof:** open /judge and follow any "link ↗" (explorer URLs for delegation, rollup transactions, VRF-resolved turns, commit).

**Description (MagicBlock Blitz):** PokeStonksss rebuilds our PokeStonks battler on Solana with MagicBlock as the backend. Each player's Trainer and Arena accounts are delegated to an Ephemeral Rollup at onboarding (≈2 s, one transaction, guests need no wallet and not even SOL afterwards). Every move runs on the rollup (≈250 ms confirm), every turn is resolved by a MagicBlock VRF roll requested only after both picks are locked (≈75 ms callback), live MagicBlock oracle prices add ±10% "market mood", duels use sealed commit-reveal picks, and ratings are committed back to Solana — no claim step. A Judge page plays a real battle from the browser and lists every transaction; a Verify page replays any match from on-chain data with the same Rust rules (compiled to WASM).

**Prior work disclosure (Colosseum):** game engine/UI foundations (Phaser world, procedural art/audio engine, battle widgets) reused from our earlier Monad prototype PokeStonks; the entire Solana/MagicBlock layer (program, rules engine, VRF/oracle/rollup integration, SDK, onboarding, duels, proof pages, creatures, UX) is new for this hackathon. Open source.

**Measured on devnet (Asia ER):** onboarding+delegation 1.8–2.4 s; start_practice 262 ms; lock_pick p50 229–270 ms; VRF→resolved p50 73 ms; sealed duel turn ≈850 ms (4 txs + VRF); load test 10 concurrent guests × 2 battles = 0 errors; 8/8 attack tests rejected; replay of on-chain logs matches final state.

**GTM:** see docs/GTM.md.
