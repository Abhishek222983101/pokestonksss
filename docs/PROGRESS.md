# Progress log (evidence per sub-phase)
- [x] P0.1 repo created: https://github.com/Abhishek222983101/pokestonksss (public), local ~/pokestonksss
- [x] P0.4 MagicBlock dev skill copied to .claude/skills/magicblock
- [x] P3.1-3.8 program `pokestonksss` (id FRxAb7Nw1GFyLkV7KN7fitTztiZuJ1y1oNEmcW3mHM1M) compiles: 393 KB .so, IDL emitted, 9 host tests green (oracle live-bytes parse, feed PDAs, settle, commitment, log cap, sizes)
- [ ] P3.10 devnet e2e: needs user to run key import + `scripts/deploy-devnet.sh pokestonksss`, then `pnpm --filter scripts e2e:practice`
- Decision: skipped separate P1 spike deployment (saves 1.6 SOL); the real program's e2e exercises delegation, ER tx, delegated VRF, oracle snapshot, commit and the unfunded-guest check (G1.a). Crank not used: duel timeouts use permissionless `claim_timeout`.
