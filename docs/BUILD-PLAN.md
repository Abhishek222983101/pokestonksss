# PokeStonksss — Build Plan (phase by phase, with sub-phases)

> Execute with `SYSTEM-ARCHITECTURE.md` open (sections referenced as §N). **Nothing is built until the user says "build".**
> Scope = only what scores at the MagicBlock Blitz (ER / VRF / Private ER, creativity, technical depth, live demo, explorer proof) and, secondarily, Colosseum. No ML, no GPU, no agent/MCP server.

---------------------------------------------------------------------------------------------------
## A. Overview

### A.1 Phase list in execution order (with difficulty ranking)
| Phase | Name | Difficulty (5 = hardest) | Risk | Lane | Est. h |
|---|---|---|---|---|---|
| P0 | Foundations (repo, toolchain, CI, keys) | 1 | low | – | 0.75 |
| **P1** | **Chain feasibility spike on devnet (GO/NO-GO)** | **5** | **highest** | A | 1.5 |
| P2 | Rules core (Rust + WASM + fixtures + balance) | 3 | low | B | 1.5 |
| **P3** | **Program v1: Practice loop (ER + VRF + oracle + rewards)** | **5** | high | A | 2.0 |
| P4 | Duel: join link, commit-reveal, crank timeouts | 4 | medium | A | 1.5 |
| **P4b** | **Private ER sealed picks (add-on, time-boxed)** | **5** | high | A | 1.5 (cap) |
| P5 | SDK, onboarding, faucet, e2e scripts | 3 | medium | A/B | 1.25 |
| P6 | Frontend port + rebrand (offline `LocalBattleSource`) | 4 | medium | C | 3.0 |
| P7 | Chain-wired UI + proof (Proof Strip, Judge, Verify, Trainer) | 4 | medium | C | 2.0 |
| P8 | Art & audio (8 BrokerMon, tracks, logo) | 3 | low | D | 1.5 |
| P9 | Hardening (chaos, load, security, commit cap) | 4 | medium | all | 1.5 |
| P10 | Deploy, docs, videos, submissions | 2 | low | – | 1.5 |
| P11 | Stretch (quick-match board, session-key wallet, share card, Magic Action prizes, 12 species) | 4 | – | – | open |

**ML needed:** none. **GPU needed:** none. **Performance mode:** not needed (only `cargo test`/balance runs use all CPU cores for seconds).
**APIs/keys needed:** (1) deployer devnet key → user imports via `! ~/bin/blitz-key-finish.sh`; (2) faucet-wallet key → `python3 ~/bin/import-solana-key.py`; (3) Vercel login/token for the new project (user-run `vercel login` or token); (4) GitHub (`gh` already logged in as Abhishek222983101); (5) Telegram login for the Blitz submission form (user); (6) Colosseum account (user). No paid API anywhere.

### A.2 Parallel lanes (merge points)
```
Lane A (chain)  : P0 ─► P1 ─────────► P3 ─► P4 ─► P4b(opt) ─┐
Lane B (rules)  :        P2 ───────┘ (needed by P3)          ├─► P5 (SDK) ─► P7 ─► P9 ─► P10
Lane C (UI)     :        P6 (uses LocalBattleSource + WASM) ──┘
Lane D (art)    :        P8 (independent; feeds P6/P7)
```
Rules: P3 needs P2's crate; P7 needs P5 + P3; P6/P8 never wait on the chain. P1 is a gate: a failed gate changes design (see fallbacks) **before** P3.

### A.3 Two submission targets (be honest with the clock)
- **Blitz slice (deadline 22:00 UTC):** P0 + P1 + P2 + P3 + P5 + P6a (title → select → battle only) + P7a (Proof Strip + onboarding) + P10a (deploy, README, video). Practice mode only; duel/overworld if time.
- **Colosseum full (06:59 UTC next day):** everything P0–P10 (+P4b if it passes its gate).
Decide at P3 completion based on the clock; never ship a broken Blitz slice — a smaller working demo beats a larger broken one.

### A.4 Working agreements (for the building agent)
1. One sub-phase at a time; **tests/acceptance first**, commit per sub-phase (`feat(P3.4): …`), push to the new repo only.
2. Never skip an acceptance check; log evidence (numbers, signatures, screenshots) in `docs/PROGRESS.md`.
3. Never handle raw keys. Anything needing a key is a **user-run script** (`scripts/*.sh`) — stop and ask the user to run it.
4. Read `node_modules/next/dist/docs` before writing Next 16 code; read `.claude/skills/magicblock/references/*` before each MagicBlock feature.
5. UI phases end with a **fidelity gate**: Playwright screenshots next to https://pokestonkss.vercel.app.
6. Keep the Rust rules the single source of truth; TS calls WASM.
7. Few subagents; parallelise only across lanes.

---------------------------------------------------------------------------------------------------
## P0 — Foundations (difficulty 1)

**P0.1 Repo.** Create GitHub repo `Abhishek222983101/pokestonksss` (public) via `gh repo create --public`; local dir `~/worlds-fair` → `mv ~/worlds-fair ~/pokestonksss`; fresh `git init -b main` (no shared history with PokeStonks); remote `origin`. Add `.gitignore` (keys, `target/`, `.env*`, `.vercel`, `test-ledger`, `*.so`).
**P0.2 Workspaces.** Root `Cargo.toml` (`[workspace] members = ["programs/*","crates/*"]`, resolver 2, `[profile.release] overflow-checks=true, lto="fat", codegen-units=1, opt-level="z"` for the program to shrink rent), `pnpm-workspace.yaml` (`apps/*`, `packages/*`), `justfile` targets: `build, test, fixtures, wasm, e2e, dev, deploy` (deploy prints "run scripts/deploy-devnet.sh yourself").
**P0.3 Toolchain.** Verify: `solana --version` 3.1.13, `anchor --version` 0.32.1, `rustc` 1.99, Node 22, pnpm 10. Install WASM tooling: `rustup target add wasm32-unknown-unknown && cargo install wasm-pack` (not installed yet). If `cargo build-sbf` cannot download platform-tools v1.52, use the manual curl in `build-recipe-er.md` §1. Remember `avm use 0.32.1` after any `avm install`.
**P0.4 Skill + docs.** Copy `~/PokeStonks/.claude/skills/magicblock` → `.claude/skills/magicblock`; copy `docs/*` (already here); create `docs/PROGRESS.md`.
**P0.5 Keys (user-run).** User runs `! ~/bin/blitz-key-finish.sh` (deployer) and imports the faucet key. Agent only reads **public addresses** (`solana address -k …`) and balances. Record both addresses in `docs/PROGRESS.md`.
**P0.6 CI.** `.github/workflows/ci.yml`: cargo test (rules), `anchor build`, `pnpm -r typecheck`, `pnpm -r test`. Cache cargo + pnpm.
**P0.7 Status gate.** `curl https://status.magicblock.app/api/services` → confirm devnet asia ER/oracle/VRF live; record.
*Acceptance:* repo public, CI green on empty skeleton, `just build` runs, addresses + balances logged.

---------------------------------------------------------------------------------------------------
## P1 — Chain feasibility spike on devnet (difficulty 5, **do first, GO/NO-GO**)

Goal: prove every MagicBlock behaviour we depend on, on the real devnet ER, **before** writing the game program. Base: `~/magicblock-blitz-research/spikes/er-vrf` (compiled) + `build-recipe-er.md`. Use a throwaway program id; nothing here ships. Needs the deployer key (user-run deploy script).
**P1.1 Spike program.** Copy `spikes/er-vrf/programs/er-vrf` → `programs/spike/`; add `oracle read` ix (SOL feed PDA, hand-parsed per §5.5) and a 2-account `Arena`+`Trainer`-like pair. Build (`anchor build`); size ≈ 420 KB → rent ≈ 2.1 SOL.
**P1.2 Deploy (user-run).** `scripts/deploy-devnet.sh spike` (reads `~/.config/solana/blitz-deployer.json`, `solana program deploy --use-rpc`, prints id). Agent never touches the key.
**P1.3 Onboard + delegate.** Node script `scripts/spike-p1.ts`: guest keypair → request faucet drip (manual transfer by user-run script is fine for the spike) → `init` + `delegate` (validator `MAS1Dt9qreoRMQ14YQuhg8UTZMMzDdKhmkZMECCzk57` in `remaining_accounts[0]`) → poll `getDelegationStatus` (router) until the ER sees the account. Record time (target ≤ 4 s).
**P1.4 ER transactions.** Send `play`-style ix to `https://devnet-as.magicblock.app` (`skipPreflight:true`, ER blockhash). Measure confirm p50/p95 over 30 tx. **Test G1.a: guest keypair with 0 lamports sends an ER tx** — record pass/fail.
**P1.5 Delegated VRF on the ER.** `request_roll` with queue `5hBR571xnXppuCPveTrctfTU7tJLSN94nq7kv7FRK5Tc`; measure request→callback over 20 samples; verify callback authenticity + idempotency. **Fallback if no callback:** request on base layer (queue `Cuj97ggr…`) before delegation (seed model in `build-recipe-per-oracle.md` §2).
**P1.6 Crank.** `ScheduleTask` iterations=2, interval 10 s for the test; confirm execution #1 is immediate (no-op) and #2 fires at the deadline. **Fallback:** client-triggered `timeout_turn` after deadline (anyone may call).
**P1.7 Commit / undelegate.** `commit` then read base-layer account → state matches; `commit_and_undelegate`; re-delegate; check the 10-commit cap behaviour; record fees actually deducted.
**P1.8 Oracle.** Read SOL/BTC feeds inside an ER ix; check staleness math (`publish_time` seconds), exponent +8; count updates/s.
**P1.9 Session token (optional now).** Create SessionTokenV2 manually (not gum-react-sdk V1); session-signed tx on the ER — pass/fail.
**P1.10 Decision record.** In `docs/PROGRESS.md` write GO / fallback for each of: guest unfunded, ER VRF, crank, commit cadence, session keys; update §5 of the architecture if any default flips.
*Acceptance:* script prints a table of all checks with explorer links; every item is PASS or has a chosen fallback; measured numbers stored for the UI chips.
*Risks:* local ER cannot run (needs nofile 1M) → devnet only; devnet congestion → retry with backoff.

---------------------------------------------------------------------------------------------------
## P2 — Rules core (difficulty 3) — runs in parallel with P1

Spec: `RULES.md` (update names: champions = BrokerMon; Margin/Pump/Hedge/Leverage vocabulary is UI text only).
**P2.1 Data.** `rules/roster.json` — 8 BrokerMon (ids 0–7: Voltfox SOL SPEED, Ironhorn BTC ARMOR, Prismoth ETH ARCANE, Surgeling SUI TIDE, Veilwisp ZEC SHADE, Gildcrest BNB ARMOR, Moonpup DOGE SPEED, Ripplet XRP TIDE), stats, 4 moves each, 3 palette hexes, flavour line, oracle feed id (SOL 6, BTC 1, ETH 2, SUI 11, ZEC 66, BNB 15, DOGE 13, XRP 14). `scripts/gen-roster.mjs` → `crates/duel-rules/src/roster_data.rs` + TS data.
**P2.2 Crate `duel-rules` (`#![no_std]`, no deps, no floats, no alloc).** Types (`Fighter`, `MatchState`, `Pick`, `Mood`, fixed-capacity `Events`), `eff(att,def)`, `damage(...)` integer pipeline (floor after every step), `resolve_turn(&mut state, picks, rnd:&[u8;32], mood:[i8;2]) -> Events`, `new_fighter(species)`, `elo_update`, `replay(log) -> Result<Outcome>`. Unit tests for every rule in §3.3/`RULES.md` (25 type pairs, guard/charge/vulnerable, speed order + KO skip, tie-breaks, MAX_TURNS).
**P2.3 House Agent.** `bot_pick(state, side, rnd, tier)` per §7 (no access to human pick). Tests: determinism, never selects invalid slot, tier noise rates.
**P2.4 Fixtures.** `cargo run -p duel-rules --example gen_fixtures` writes `rules/fixtures/turns.json` (≥500) + `bots.json` (≥200).
**P2.5 WASM.** `crates/duel-wasm` (`wasm-bindgen`): `resolveTurn`, `replay`, `previewDamage`, `roster`; `wasm-pack build --target web` → `packages/rules-wasm`; TS wrapper + vitest that loads fixtures and asserts exact equality. Thin TS fallback implementation only if WASM loading fails in Next (decide by testing in P6).
**P2.6 Balance.** `examples/balance.rs`: 64 pairings × 2,000 seeded fights with the House Agent; tune `roster.json` until each BrokerMon wins 42–58%, no pairing >70%, mean 5–9 turns; regenerate data + fixtures.
*Acceptance:* `cargo test` + `pnpm --filter rules-wasm test` green; balance table saved to `docs/PROGRESS.md`.

---------------------------------------------------------------------------------------------------
## P3 — Program v1: Practice loop (difficulty 5)

Everything in §5 except duel/sealing. Patterns: `spikes/er-vrf/programs/er-vrf/src/lib.rs`; docs in `.claude/skills/magicblock/references/{delegation,vrf,pricing-oracle,fees-and-commit-economics}.md`.
**P3.1 Scaffold.** `programs/pokestonksss` with `#[ephemeral]` before `#[program]`; Cargo deps per §5.1; `consts.rs` (seeds, queue ids, feed ids/addresses, validator keys, `MAX_TURNS=16`, oracle max age 10 s).
**P3.2 State.** `state.rs`: `Trainer`, `Arena` (§5.2) with `InitSpace` and compile-time size asserts (`Arena::SIZE <= 800`); `errors.rs`.
**P3.3 Onboarding ix.** `onboard` (init both PDAs); `delegate_trainer`, `delegate_arena` (`#[delegate]` contexts, validator from `remaining_accounts[0]`).
**P3.4 start_practice.** Requires Arena `IDLE|FINISHED`; seats player (species from Trainer unlock check — all 8 unlocked) and House Agent; snapshots oracle prices (validated parse); phase=PICKING. `oracle.rs`: `read_price(feed_ai, expected_pda) -> Option<(i64 price, i64 publish_time)>` with all checks from §5.5.
**P3.5 lock_pick + VRF request.** `#[vrf]` context; stores pick; computes `bot_pick` (tier from arg) using only public state; builds `create_request_scoped_randomness_ix` with `accounts_metas = [arena, trainer0, trainer1(optional), feed0, feed1]`, `callback_args = for_turn`; sets `vrf_pending`, `rnd_turn`.
**P3.6 callback_turn.** `#[vrf_callback]`; ignore stale/duplicate (`!vrf_pending || rnd_turn != for_turn`); compute `mood` from feeds vs snapshots; call `duel_rules::resolve_turn`; append `TurnRec` (picks, `rnd[0..8]`, hp, mood, flags); on KO/MAX_TURNS → `settle()`: Elo, wins/losses/streak, `dex_mask |= defeated species`, `unsaved+=1`, phase=FINISHED. Compute budget: add `ComputeBudget` ix ≥ 400k in tests; target callback ≤ 200k CU.
**P3.7 commit.** `commit_trainer` via `MagicIntentBundleBuilder` (call `exit()` first); `save_and_leave` = `commit_and_undelegate` for trainer+arena.
**P3.8 Auth.** `#[session_auth_or(owner==signer, SessionError::InvalidToken)]` on player ix; negative tests.
**P3.9 Tests.** Host unit tests (state sizes, oracle parse on recorded live bytes from `spikes/per`), base-layer local-validator e2e pattern from `spikes/er-vrf/client/e2e-base.ts`, negative suite (wrong signer/phase, stale callback, forged feed, early lock after FINISHED).
**P3.10 Devnet e2e.** `scripts/e2e-practice.ts`: onboard → delegate → start_practice → play to KO → print every signature + latency table → commit → fetch committed Trainer from base. User-run `scripts/deploy-devnet.sh pokestonksss`.
*Acceptance:* a full practice battle on devnet in a script; tap→first selectable turn p50 < 1.0 s; lock→resolved p50 < 1.5 s; replay of the stored log reproduces HP/winner; sizes and CU recorded. **This is the Blitz-slice backbone.**

---------------------------------------------------------------------------------------------------
## P4 — Duel: join link, commit-reveal, crank (difficulty 4)
**P4.1 open/cancel/join.** `open_duel(species, token_hash)`; `join_duel(species, token)` verifies `sha256(token)`, seats guest, phase=PICKING, arms timeout; `cancel_duel`; expiry: join rejects if `now > opened_at + 600 s`.
**P4.2 Sealing (`commit_reveal`).** `commit_pick(hash)` where `hash = sha256(slot‖salt32‖arena‖turn‖player)`; when both committed → REVEALING; `reveal_pick(slot, salt)` verifies hash; 2nd reveal issues the VRF request (same VRF plumbing as P3.5).
**P4.3 Timeouts.** `ScheduleTask` (iterations 2, interval 30 s) armed at each phase start; `timeout_turn` (crank-signer PDA) applies defaults: missing commit → forced GUARD; missing reveal → forfeit that turn's pick = GUARD; two consecutive timeouts → forfeit match. Fallback if crank misbehaves (P1.6): permissionless `claim_timeout`.
**P4.4 Guest Trainer.** Settle updates both Trainers; both must be delegated to the same validator (document in `join_duel` check via account owner/delegation status).
**P4.5 Tests/e2e.** `scripts/e2e-duel.ts` with two keypairs; negatives: wrong token, reveal mismatch, early reveal, double join, spectator write, rematch on live arena.
*Acceptance:* duel completes on devnet between two scripted guests; join-to-first-turn < 1.5 s.

---------------------------------------------------------------------------------------------------
## P4b — Private ER sealed picks (add-on, difficulty 5, **time-box 90 min**)
Only after P3 + P4 pass. Source: `build-recipe-per-oracle.md` §1–2, spike `spikes/per`. Feature flag `SEAL_MODE=per`.
**P4b.1** Port `init_permission`, `lock_pick` (private owner-only permission check), `resolve_turn` (slot-gated), delegation to TEE `MTEWGuqxUpYZGFJQcp8tLN7x5v9BSeoFHYWQQ3n3xzo`, permission program `ACLseoPo…`.
**P4b.2** Client TEE auth (`verifyTeeRpcIntegrity`, `getAuthToken` with burner signer), tokenized WS + 2.5 s poll; wait for permission active before first TEE tx.
**P4b.3** Randomness: base-layer VRF seed before delegation; per-turn roll = `sha256(seed‖turn‖moveA‖moveB‖nonceA‖nonceB)`.
**P4b.4** "Peek-Proof" UI: button attempts `getAccountInfo(opponentPick)` → shows `null` + attestation badge; finish via `commit_and_undelegate` publishing the move log.
**Kill criteria:** if by 90 min a full duel does not complete on the TEE, stop, keep `commit_reveal`, delete the flag from UI. *Acceptance:* Peek-Proof demo works live and a duel completes.

---------------------------------------------------------------------------------------------------
## P5 — SDK, onboarding, faucet, scripts (difficulty 3)
**P5.1 `packages/sdk`.** Modules per §6.1; generate types from `target/idl/pokestonksss.json` (`anchor build` emits IDL with CLI 0.32.1); `explorer.ts` (base vs ER links); `latency.ts` rolling p50/p95; `session.ts` manual V2 token.
**P5.2 Connections.** Base `https://rpc.magicblock.app/devnet`; ER `https://devnet-as.magicblock.app` (+wss); router for delegation status; env-driven.
**P5.3 Tx helper.** `sendEr(tx)`: ER blockhash, `skipPreflight:true`, confirm by account subscription or `getSignatureStatuses` poll (200 ms), retry with backoff on blockhash errors; always return `{sig, ms}`.
**P5.4 Subscriptions.** `watchAccount(pubkey, cb)` over ER WS with automatic resubscribe + 2 s poll fallback; decode with IDL coder.
**P5.5 Faucet API.** `apps/web/app/api/drip/route.ts` (Next route handler): validates pubkey, per-IP/hour + per-pubkey limits (in-memory + header IP), refuses below `FAUCET_FLOOR_LAMPORTS`, transfers `DRIP_LAMPORTS` (0.03 SOL) from `FAUCET_SECRET_KEY`; returns signature. Idempotent for a pubkey that already has ≥0.02 SOL.
**P5.6 Onboarding state machine.** `loadOrCreateGuest()` (localStorage) → `ensureFunded()` → `ensureOnboarded()` (account existence checks make it resumable) → `ensureDelegated()` → ready; emits step events for the UI.
**P5.7 Scripts.** `e2e-practice.ts`, `e2e-duel.ts` (from P3/P4), `judge-selftest.ts` (headless version of §10.3), `loadtest.ts` (N concurrent guests × battles; prints failures, p50/p95).
*Acceptance:* fresh browser-less run of `judge-selftest.ts` passes; onboarding ≤ 4 s p50; loadtest 20 guests × 5 battles = 0 unrecovered errors.

---------------------------------------------------------------------------------------------------
## P6 — Frontend port + rebrand (difficulty 4, Lane C — starts as soon as P2.5 exists)
Source `~/PokeStonks/apps/web`. Target `apps/web` (scaffold exists: Next 16.3.5 + Tailwind 4; **read `node_modules/next/dist/docs` first**).
**P6.1 Dependencies.** Match PokeStonks pins: `phaser ~3.80.1`, `grid-engine 2.45.0`, `maplibre-gl ^6.10`, `zustand`, `howler`, `@fontsource/press-start-2p`, `@tanstack/react-query`; copy `scripts/copy-maplibre-worker.mjs` + `predev/prebuild`; `next.config.ts` (`transpilePackages` for `@pokestonksss/*`, WASM handling via `asyncWebAssembly`). Smoke: Next dev + Phaser mount (use `import * as Phaser from 'phaser'`).
**P6.2 Copy engine (no web3).** `game/audio`, `game/art` (pixel/paint/monkit/characters/tileset/tileProps/themes/battle), `game/overworld`, `game/scenes/{Boot,Preload,Overworld}`, `game/battle/*` (menu, plates, dialog, fx, end, ui, turns), `PhaserMount.tsx`. Delete `net/*`, `flow/*`, `web3/*`, claim/wallet components, tap-timing bar.
**P6.3 Types bridge.** Replace `game-core` imports with `@pokestonksss/rules-wasm` types (`Species`, `Move`, `TurnEvent`); map our events (`miss, hit{dmg,crit,eff}, guard, charge, ko, mood`) to the existing animation functions in `battle/turns.ts`.
**P6.4 BattleSource.** `lib/battleSource.ts` interface; `LocalBattleSource` (WASM rules + House Agent, instant) and a stub `ChainBattleSource`. Rewire `BattleScene` to consume only the interface: menu → `source.lock(slot)`; snapshot/subscription drives plates/HP bars/dialog; end overlay shows result (no claim).
**P6.5 Rebrand + title.** Pixel logo "PokeStonksss" (same pixel-title component, new palette tweak), copy "Pick a BrokerMon, battle other players, climb from Shrimp to Whale on Solana devnet"; chips "devnet · Ephemeral Rollup"; Play as guest / Connect wallet (wallet later, P11).
**P6.6 BrokerMon select + globe.** `BrokerSelect` with 8 cards (type icon, stats, **live price + arrow** placeholder from LocalBattleSource until P7); Globe (MapLibre) with 8 route pins (positions = chain-themed cities), pin click → "Enter Route".
**P6.7 Overworld.** Re-skin `maps.ts` to 8 routes (palette/theme per asset, same generators), keep trainers/NPC dialogs (rewrite flavour text to crypto), encounter = deterministic `hash(routeSeed, step)` (seed from LocalBattleSource now, VRF in P7).
**P6.8 Fidelity gate.** Playwright script `scripts/fidelity.ts`: screenshots of title, select, globe, overworld, battle at 1280×800 and 390×844 for both apps; save under `docs/fidelity/`; review side by side; fix until nothing looks off (full-screen canvas, ~3× camera, HUD panels, music).
*Acceptance:* offline game playable start-to-finish (title → route → encounter → battle → result) with identical feel to PokeStonks; typecheck + lint clean; fidelity screenshots approved by the user.
*Blitz slice cut (P6a):* title → select → battle only.

---------------------------------------------------------------------------------------------------
## P7 — Chain-wired UI + proof (difficulty 4)
**P7.1 ChainBattleSource.** Uses SDK: `startPractice`, `lock`, subscribes to Arena; converts new `TurnRec`s into `TurnEvent`s via WASM `resolveTurn` replay for animation (so UI = deterministic function of chain state); handles reconnect (resubscribe, read current Arena, resume).
**P7.2 Onboarding overlay ("Wristband").** Three live steps with real tx links and timings; error states (faucet empty, RPC down) with retry; resumable.
**P7.3 Weigh-in.** HUD strip: both assets' live prices (ER WS on feed accounts), arrow vs snapshot, mood chip (+10%/0/−10%); "oracle idle" fallback.
**P7.4 Proof Strip.** Four chips under the battle — **Weighed** (oracle slot + snapshot), **Sealed** (commit sig; PER attestation when enabled), **Rolled** (VRF request + callback sigs, randomness hex), **Saved** (commit sig once saved) — each with explorer link (`explorer.ts`) and ms. Persistent badge "LIVE · EPHEMERAL ROLLUP · devnet" + latency chip (p50/p95).
**P7.5 Route seed.** On entering a route: ER tx requests VRF seed (stored in Trainer/Arena scratch field); overworld uses `sha256(seed‖route‖step)`; chip "Fair encounter seed ✓" with receipt link.
**P7.6 Duel UI.** "Challenge a friend" → link + QR (`qrcode` lib) `/d/[arena]#token`; `/d/[arena]` page: guest onboarding, species pick, join, "Opponent joined", countdown; turn timer (crank deadline) visible; rematch.
**P7.7 Trainer Card + BrokerDex.** Rating tier (Shrimp→Whale), wins/losses/streak, dex grid (bitmask), "Saved to Solana ✓" state; leaderboard page via `getProgramAccounts` on committed Trainer accounts (base layer).
**P7.8 Judge page `/judge`.** One-button self-test per §10.3 using the SDK in-browser; checklist with links; copyable summary for the submission form.
**P7.9 Verify page `/verify/[arena]`.** Fetch Arena (ER or base), run `replay`, show per-turn rolls/picks/mood and ✓/✗.
**P7.10 Errors/edge UX.** Toasts for tx failure, stale session, devnet lag; never leave the player stuck (always "Reset arena" action when phase is stuck > 60 s).
*Acceptance:* Playwright: fresh visitor → guest → practice win → saved, in < 90 s; 2 browser contexts complete a duel via link; reload mid-battle resumes; Judge page passes.
*Blitz slice cut (P7a):* onboarding overlay + Proof Strip + latency chip + Judge page.

---------------------------------------------------------------------------------------------------
## P8 — Art & audio (difficulty 3, Lane D, independent)
**P8.1 BrokerMon art.** 8 species with the existing `MonCtx` kit (`art/species/*`: `p.blob`, `p.facet`, ramps; front and back views at 32×32 logical grid, per-type files). Concept lines per `roster.json` (Voltfox electric fox, Ironhorn armoured bull, Prismoth crystal moth, Surgeling water serpent, Veilwisp ghost wisp, Gildcrest golden crest-bird, Moonpup moon pup, Ripplet rippling eel). Review each in a sprite sheet screenshot against PokeStonks quality.
**P8.2 Portraits/icons.** `portraits.ts`, type icons, asset glyphs (SOL/BTC/…) as original pixel marks (no trademarked logos).
**P8.3 Audio.** Reuse engine; compose 2 new tracks (night-fair title, battle) with `song_*.ts` + `theory.ts`; keep 26 SFX; add "seal", "roll" jingles.
**P8.4 Logo/OG image.** Pixel logo, favicon, OG card for sharing duel links.
*Acceptance:* sprite sheet + audio check approved by user; no placeholder shapes.

---------------------------------------------------------------------------------------------------
## P9 — Hardening (difficulty 4)
**P9.1 Security suite** (§5.9) as automated tests; run against devnet program.
**P9.2 Chaos.** Kill network mid-turn; double-submit; stale tab; reload during REVEALING; faucet exhausted; ER endpoint down (fallback to base RPC read + banner).
**P9.3 Load.** `loadtest.ts` 20–50 guests; watch faucet floor and RPC limits; add backoff/jitter.
**P9.4 Commit-cap path.** When `commits ≥ 9`: `commit_and_undelegate`, then silent re-delegate, UI "Saving…" state.
**P9.5 Perf.** Lighthouse/bundle check (WASM lazy-load, Phaser chunking), mobile 390×844 touch controls, 60 fps overworld.
**P9.6 Observability.** `/judge` shows RPC/ER health, program id, balances (faucet), status API.
*Acceptance:* all suites green; no stuck states in 100 scripted battles.

---------------------------------------------------------------------------------------------------
## P10 — Deploy, docs, videos, submissions (difficulty 2)
**P10.1 Final program deploy** (user-run); update `Anchor.toml`, README program-id table, SDK env.
**P10.2 Vercel.** New project `pokestonksss` (root `apps/web`, include files outside root, git-linked) → `pokestonksss.vercel.app`; env per §9; faucet key via user-run `scripts/set-vercel-env.sh` (reads gitignored `.env`). Verify with Playwright as a fresh visitor on the **deployed** URL.
**P10.3 README (judge-first).** One-liner, live link, 5-step "verify it yourself" (open `/judge`, click, follow links), architecture diagram, MagicBlock usage table (ER/VRF/crank/oracle/session/commit/PER) with explorer links, program ids, how to run locally, **lineage disclosure**: "Game engine/UI foundations reused from our earlier Monad prototype (PokeStonks); all Solana/MagicBlock code, rules, creatures and UX are new this week."
**P10.4 Videos.** 2–3 min pitch (problem → demo → why ER/VRF → traction path) and ≤3 min demo (script §10.4). Record with a fresh guest on the deployed site.
**P10.5 Business/GTM page** (`docs/GTM.md`): sponsored routes (protocols pay for a themed route/booth), shareable duel links as growth loop, Forge path.
**P10.6 Submit.** MagicBlock form (Telegram login, wallet, repo, site, demo video, explorer link, program ids, categories Games + Consumer); Colosseum (register, disclosure of prior work, videos, GTM). Keep repo public.
*Acceptance:* both submissions filed before deadlines; deployed demo passes `/judge`.

---------------------------------------------------------------------------------------------------
## P11 — Stretch (only after P10a is safe)
Quick-match board (`getProgramAccounts` memcmp on status byte; bot offer at 3–5 s, auto-fill 8 s) · session-key wallet flow ("Save your ribbons") · share card (OG image of result) · Magic Action prize push on commit · 12 BrokerMon (verify more feed ids in `build-recipe-per-oracle.md` list) · spectator view (read-only subscription) · daily streak counter.

---------------------------------------------------------------------------------------------------
## Appendix — sub-phase checklist template (copy into `docs/PROGRESS.md`)
`[ ] P<n>.<m> — what — evidence (sig/number/screenshot) — date/time — notes`
Gates: **G1** (end P1) chain assumptions decided · **G2** (end P3) practice battle on devnet · **G3** (end P6) offline game feels like PokeStonks · **G4** (end P7) chain-wired demo · **G5** (end P9) stability · **G6** (end P10) submissions filed.
