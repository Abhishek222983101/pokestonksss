# Submission copy (ready to paste)

**Project name:** PokeStonksss
**One-liner:** A crypto creature battler where MagicBlock's rollups are the game server: instant, provably fair, private when you want it, and winning pays in badge tokens.
**Live:** https://pokestonksss.vercel.app · Judge demo: https://pokestonksss.vercel.app/?demo=1 · Self-test: https://pokestonksss.vercel.app/selftest · Repo: https://github.com/Abhishek222983101/pokestonksss
**Program (devnet):** FRxAb7Nw1GFyLkV7KN7fitTztiZuJ1y1oNEmcW3mHM1M · **Categories:** Games, Privacy, Consumer · **Evidence:** docs/PROOFS.md

**Description (MagicBlock Blitz):**
PokeStonksss is a creature battler where every move is an onchain transaction on a MagicBlock Ephemeral Rollup, confirmed in about 250 ms. Connect your Solana wallet once and a session key signs your moves for you, so nothing pops up in the middle of a fight. No wallet yet? Start as a guest in one click.

Each turn your move is locked before MagicBlock VRF rolls the dice, so nobody can predict or rig the outcome. In 1v1 duels your pick is sealed inside a Private Ephemeral Rollup running in a TEE, so your opponent cannot peek until both picks are in. Live MagicBlock oracle prices swing the damage, so the market is part of the fight.

Winning pays. Your creatures level up and evolve, wins mint badge tokens to your wallet, tier ups mint rarer ones, and your rating settles back to Solana with no claim step. If a player walks away, a MagicBlock crank closes the turn on its own.

**What is verifiable (docs/PROOFS.md):** rollup latency, VRF per turn, oracle weigh in, one-approval session key, XP and evolution on chain, badge SPL tokens, a crank-settled duel, and a Private ER duel where reading the opponent's sealed pick returns null (tested with the opponent's own login, a stranger's login and no login). Every roll of a private duel recomputes from the public VRF seed and both sealed nonces.

**Prior work disclosure (Colosseum):** game engine and UI foundations (Phaser world, procedural art and audio engine, battle widgets) reused from our earlier Monad prototype PokeStonks; the entire Solana and MagicBlock layer (program, rules engine, rollup, VRF, oracle, session key, crank and Private ER integration, SDK, onboarding, duels, rewards, proof pages, creatures, UX) is new for this hackathon. Open source.

**Measured on devnet:** rollup move p50 about 220 ms, VRF to resolved about 70 ms, onboarding 2.4 s, one wallet signature for create + delegate + session key, private duel from invite to live about 7 s and about 1 s per sealed turn, 0 errors in a 10 guest load test, 8 attack tests rejected.

**GTM:** see docs/GTM.md. Next: mainnet, a Solana Seeker build through the dApp Store, ranked seasons and prize pools paid straight to winners' wallets.
