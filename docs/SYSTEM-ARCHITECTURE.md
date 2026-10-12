# PokeStonksss — System Architecture (Solana + MagicBlock edition)

> **The reference for building.** Companion docs: `BUILD-PLAN.md` (phases/sub-phases to execute), `OVERVIEW.md` (human-readable concept),
> `RULES.md` (game rules spec). Written 2026-10-12 for the MagicBlock Solana Blitz V9 hackathon (+ Colosseum Crypto World's Fair).
> Status: **PROPOSAL — no code is written until the user says "build".** Every external fact carries a source; `[UNVERIFIED]` = not yet run.

Evidence tags used below: **[COMPILED]** built in our spikes · **[LIVE]** observed on devnet · **[DOC]** read in docs/source · **[UNVERIFIED]** must be proven in Phase 1.

---------------------------------------------------------------------------------------------------
## 0. How to read this document

| Part | Question |
|---|---|
| 1 Problem statement | What exactly did the organisers ask for (verbatim)? |
| 2 Gist, demands, gap matrix | What must we deliver, and where in the system is each demand covered? |
| 3 Product & game design | What is PokeStonksss, what stays from PokeStonks, what is new? |
| 4 System architecture | Boxes, wires, repo layout, end-to-end flows (with diagrams) |
| 5 On-chain program | Accounts, instructions, state machine, randomness, oracle, sealing, crank, rewards, security |
| 6 Client & frontend | SDK, game engine, UI, design-fidelity rules, port map |
| 7 House Agent & balance | How the on-chain bot works and how the roster is balanced (no ML) |
| 8 Tech stack | Languages, versions, why this mix |
| 9 Infra, env, keys | Deploy, env vars, secret handling |
| 10 Verification | Test matrix, gates |
| 11 Risks & fallbacks | |
| 12 References | Links, local folders, reading order for the build agent |

---------------------------------------------------------------------------------------------------
## 1. The problem statement (verbatim sources)

### 1.1 MagicBlock Solana Blitz V9 — Luma page (https://luma.com/832wilvl, fetched 2026-10-12)
> "Solana Blitz v9 — Monday, Oct 5, 2026 · 10:00 PM – Monday, Oct 12, 2026 · 10:00 PM (UTC+08:00) — Online Event — Organizer: MagicBlock.
> A hackathon series for building real-time apps on Solana. This edition runs a full week, from IRL to online, through Crypto World's Fair, the Solar Mini Hacker House or wherever you are.
> We kick off with a livestream on Monday, Oct 5 at 10 PM Singapore time (2 PM UTC).
> Submit to Blitz and turn your idea into an MVP. Prizes go to projects using Ephemeral Rollups or Private ERs, but anything built with MagicBlock is welcome to submit.
> 🥇 1st Prize — $500 USDC · 🥈 2nd Prize — $250 USDC · 🥉 3rd Prize — $150 USDC · 🧙 Wizardio's Choice — $100 USDC
> No team yet? Add your role and proof of work to the builder directory, then browse what others are shipping and reach out to them. [...]
> Discover resources on how to build with MagicBlock's Ephemeral Rollups and its plugins including onchain privacy, randomness, automation: docs.magicblock.gg
> Submit your project before the deadline at https://build.magicblock.app/?stage=blitz#submit"

### 1.2 MagicBlock X thread, 2 Oct 2026 (https://www.unrollnow.com/status/2106006452670480845)
> "Building for Colosseum? Your hackathon project can win twice." · "Projects using Ephemeral Rollups, Private Ephemeral Rollups, or MagicBlock VRFs will be eligible for prizes." · "With our AI Dev Skill, you can build an MVP within minutes." · "Blitz is step one. Ship an MVP this week, then grow users in Forge."

### 1.3 Official panel text (https://build.magicblock.app/api/panels, blitz)
> Eligibility: "Every submission must integrate MagicBlock's Ephemeral Rollup or VRF. The top prize rewards the strongest overall build."
> Judging: "Projects are judged on creativity, technical depth, and how compellingly they showcase what's possible on Solana."
> Tagline: "Ship an MVP and win prizes".

### 1.4 Submission form fields (https://build.magicblock.app/?stage=blitz#submit)
Name, email, country, role(s), **wallet (required to submit — prizes pay here)**, project name, description, categories (≤3: DeFi, Payments, Games, AI/Agents, Privacy, Infra, DePIN, Social, Consumer, Other), project website, **GitHub repo ("must be accessible")**, Pitch & Demo, **Explorer link (integration proof)**, program addresses (optional), additional info, X account, team members (Telegram handles). Login = Telegram.

### 1.5 Colosseum — Crypto World's Fair (second target; same project "can win twice")
- Rules PDF (https://colosseum.com/legal/Crypto%20World's%20Fair%20Hackathon%20Rules.pdf) §8, verbatim criteria: "(a) Functionality: How well does this Project Submission work? What is the quality of the code? (b) Potential Impact: … (c) Novelty: How unique is this Project Submission's concept? (d) UX: How well does this Project Submission utilize blockchain to create great UX for downstream users? (e) Open-source: Is this Project Submission open-source? How well does the Project Submission compose with other primitives in the crypto ecosystem? (f) Business Plan: Is there a viable business that can be built in the future around this Project Submission?"
- Contest period ends **11:59pm PT Oct 12 2026 (= 06:59 UTC Oct 13)**; registration on colosseum.com must be done before then; one submission per team.
- https://colosseum.com/hackathon: "Teams may begin development before the hackathon, but products are judged only on the work completed between the competition's start and end dates. Builders may use pre-existing code, but teams must disclose all relevant past development work in the submission form." Misrepresentation → disqualification, ban from future hackathons, revoked prizes.
- Portal asks: product name/description; blockchains and tools integrated; teammates; location; logo; GitHub link; **2–3 min presentation video** ("one of the first resources judges review"); **≤3 min demo video**; go-to-market strategy, demand validation, distribution plans.
- Prizes: Grand $30K; next 20 projects $15K each; Public Good $5K; University $5K; Solana ecosystem track $100K (10 × $10K); accelerator $250K.

### 1.6 Deadlines
| | UTC | IST |
|---|---|---|
| Blitz V9 submissions close | 2026-10-12 22:00 | 2026-10-13 03:30 |
| Colosseum contest ends | 2026-10-13 06:59 | 2026-10-13 12:29 |

---------------------------------------------------------------------------------------------------
## 2. Gist, key demands, gap matrix

### 2.1 The gist in five lines
1. Build a **real-time Solana app that cannot work without MagicBlock** (Ephemeral Rollup and/or VRF and/or Private ER) — that is the eligibility gate.
2. Judges score **creativity, technical depth, how compellingly it shows what is possible** → the integration must be central, visible, provable (explorer links).
3. They **test the live app** → first 60 seconds must work with no wallet, no SOL, no cold start; the demo must stay up.
4. It is an **MVP with a path to users** (Forge) and, for Colosseum, a startup story (video, GTM, open source, disclosure).
5. Past winners: one-sentence mechanic + named primitive + a concrete number; games dominate; ER is combined with VRF and/or PER.

### 2.2 Demand → module → phase → acceptance (nothing may be missed)
| # | Demand (source) | How we satisfy it | Module(s) | Phase | Acceptance test |
|---|---|---|---|---|---|
| D1 | Must integrate ER (§1.3) | Arena + Trainer accounts delegated; every hot-path tx runs on the ER | program, sdk | P1,P3 | explorer links of ER txs; `delegate→ER tx→commit` script green |
| D2 | VRF (§1.2) | One VRF request per turn **after both picks are locked**; callback resolves the turn | program | P1,P3 | request + callback sigs shown in Proof Strip; replay recomputes rolls |
| D3 | Private ER eligible (§1.1/1.2) | Sealed picks in TEE as flagged add-on after the loop works; fallback commit-reveal | program, sdk | P4b | "Peek-Proof" button shows denied read; attestation badge |
| D4 | Creativity (§1.3) | PokeStonks-style world where creatures are live crypto markets; sealed simultaneous strike/guard/charge triangle; instant on-chain House Agent | web, rules | P2,P6 | demo script §10.4 |
| D5 | Technical depth (§1.3) | Shared Rust rules (SBF + WASM), per-turn VRF, oracle weigh-in, crank timeouts, session keys, replay verifier | all | P1–P7 | `docs/ARCHITECTURE` + judge page |
| D6 | "Compellingly showcase" (§1.3) | Proof Strip, Peek-Proof, live latency chips, Verify page, Judge page self-test | web, sdk | P7 | judge self-test passes in <60 s |
| D7 | Explorer link, program addresses, public repo (§1.4) | Deterministic explorer-link builder; README table of program ids; public repo | sdk, docs | P11 | links resolve; repo public |
| D8 | MVP with growth path (§1.2) | Trainer Card, BrokerDex collection, shareable duel links, rating ladder | web, program | P7 | second device joins via link |
| D9 | Live app must work for judges (§1 "must be accessible"; practice) | No server; guest + faucet; pre-delegated arenas; chaos/load tests | all | P10 | 20 concurrent bot guests, 0 failures |
| D10 | Colosseum: Functionality/code quality | tests, CI, typed SDK, replay verifier | all | P10 | CI green |
| D11 | Colosseum: Novelty/UX | PokeStonks-grade pixel UX on Solana, no claim step, instant bot | web | P6,P7 | fidelity gate screenshots |
| D12 | Colosseum: Open-source & composability | public repo, typed SDK package, published IDL | sdk | P11 | README quickstart works |
| D13 | Colosseum: Business plan, videos, disclosure | `docs/GTM.md`, 2 videos, lineage disclosure | docs | P11 | forms filled |
| D14 | AI Dev Skill emphasis (§1.2) | skill copied into repo `.claude/skills/magicblock`; used during build; mentioned in README | repo | P0 | skill present |

---------------------------------------------------------------------------------------------------
## 3. Product & game design

### 3.1 What PokeStonks was, and what it becomes
PokeStonks (live: https://pokestonkss.vercel.app, repo ~/PokeStonks) is a **Pokémon-Go-feel** browser game: pick a market on a globe, walk a pixel route, hit tall grass, get pulled into a live 1v1 against a human or bot, win, claim a reward. Its weak spots: Render cold start (~30 s) + bot fill after 20 s, fiddly 5-char duel codes, a claim step needing a wallet + gas.

**PokeStonksss** = the same feel and polish (full-screen canvas, ~3× camera, dense procedural routes, HUD panels, procedural music), rebuilt as a **Solana + MagicBlock** game where **the rollup is the game server**:
| Area | PokeStonks (Monad) | PokeStonksss (Solana/MagicBlock) |
|---|---|---|
| Battle authority | Colyseus server on Render | Delegated `Arena` account on a MagicBlock ER; program enforces rules |
| Randomness | server RNG | MagicBlock VRF per turn + verifiable encounter seed |
| Hidden picks | trusted server | sealed commit-reveal (default) / Private ER (add-on) |
| Prices | Pyth Hermes (1 of 12 feeds worked) | MagicBlock real-time pricing oracle (all 8 launch assets live on devnet) |
| Reward | synthetic stock token + NFT via voucher + wallet gas | `Trainer` profile (rating, wins, BrokerDex bitmask) updated **inside the battle tx**; committed to Solana in batches — no claim step |
| Wallet | wagmi/MetaMask | guest burner key (zero popups) + optional wallet via session key |
| Creatures | 12 stock-ticker BrokerMon | 8 crypto-asset BrokerMon (SOL BTC ETH SUI ZEC BNB DOGE XRP) – 12 once more feeds verified |
| Tap-timing mini-game | client-side | dropped (unverifiable on-chain) |

Name/branding: **PokeStonksss** (pixel-logo parody name; repo `pokestonksss`, Vercel `pokestonksss.vercel.app` — both free 2026-10-12). Separate repo, separate deploy link, no shared history with PokeStonks. **Lineage is disclosed** in README and the Colosseum form (their rule; non-disclosure risks DQ/ban).

### 3.2 Player journey (canonical loop)
```
Title ─► [Play as guest] / [Connect wallet]
   │  guest: key made in browser → /api/drip 0.03 SOL → onboard tx → delegate (≈3-4 s ONCE, progress shows real tx links)
   ▼
BrokerMon select (8 cards: type icon, stats, LIVE price + 1h arrow from oracle)
   ▼
Globe (MapLibre) with 8 route pins ─► Enter Route ─► Overworld (Phaser + grid-engine)
   │  walk tall grass: encounter is a pure function hash(routeSeed, stepIndex) < 11%  → verifiable, no tx per step
   │  route seed = VRF output requested when entering the route
   ▼
Encounter flash + VS cutscene ─► opponent = open duel challenger | House Agent (instant)
   ▼
Battle (sealed simultaneous picks · VRF roll · oracle weigh-in)  ──►  Result: rating Δ, BrokerDex entry, "Saved to Solana ✓ sig"
   ▼
Rematch · Challenge a friend (link/QR) · Trainer Card · Back to Globe
```
Modes: **Wild/Trainer encounter** (route), **Practice** (instant, labelled House Agent), **Duel link** (host shares `/d/<arena>#<token>`; join = one ER tx), **Quick Match** (Tier 3: open-challenge board; bot offered at 3-5 s, auto-fill at 8 s, never >60 s spinner).

### 3.3 Battle (summary — full spec `RULES.md`)
Level-50-style fixed stats; 5 types (SPEED, ARMOR, ARCANE, TIDE, SHADE) on a pentagon chart (×2 / ×0.5); each BrokerMon has 4 slots: Signature STRIKE, Coverage STRIKE, GUARD ("Hedge"), CHARGE ("Leverage"). **Simultaneous sealed picks**; triangle STRIKE > CHARGE > GUARD > STRIKE. Damage = integer formula with STAB, type, variance, crit, **market mood** (oracle: price now vs price at the bell → ±10%), charge ×2, guard ×0.2. HP is called **Margin**; KO = "Liquidated". Randomness bytes come from one VRF output per turn, requested **only after both picks are locked** (prevents peeking/simulation attacks). Match length target 5–8 turns (~60–90 s).
Rank ladder by crypto wallet tiers: Shrimp → Crab → Dolphin → Shark → Whale (Elo K=24, start 1000).

### 3.4 UX rules (from research `mechanics-research.md`)
Practice is never behind a queue; first 3 fights double as tutorial; duel link joins in 2 taps; measured latency chips (no fake "50 ms"); optimistic scene on tap; House Agent always labelled; Proof Strip chips **Weighed · Sealed · Rolled · Saved**; guest first, wallet later ("Save your ribbons").

---------------------------------------------------------------------------------------------------
## 4. System architecture

### 4.1 Planes
```
┌───────────────────────────────────────────────────────────────────────────────────────────────┐
│ PLANE A — BROWSER (Vercel static + 1 serverless route)                                          │
│  Next.js 16 / React 19 shell ── Phaser 3.80 game (Boot→Title→Globe→Overworld→Battle)            │
│  @pokestonksss/sdk (TS)  ◄──► rules-wasm (Rust→WASM: previews, replay verifier)                │
│  guest key (localStorage, encrypted-at-rest NOT required: devnet) · session key (wallet users)  │
│  /api/drip  (serverless: devnet faucet, rate-limited)                                           │
└───────────────┬───────────────────────────────────────────┬─────────────────────────────────────┘
                │ base-layer txs (onboard, delegate)         │ ER txs + account subscriptions (WS)
                ▼                                            ▼
┌──────────────────────────────┐   delegate / commit   ┌────────────────────────────────────────┐
│ PLANE B — SOLANA DEVNET      │ ◄───────────────────► │ PLANE C — MAGICBLOCK ER (Asia devnet)  │
│ Program `pokestonksss`        │   undelegate          │ validator MAS1Dt9q…  (router optional) │
│ Trainer / Arena PDAs (owner)  │                       │ Arena + Trainer run here (≈ms txs)     │
│ Delegation program DELeGG…    │                       │ VRF oracle (delegated queue 5hBR571x…) │
│ Pricing-oracle feeds (stale)  │                       │ Pricing oracle feeds (LIVE, 50–200 ms) │
│ Explorer: cluster=devnet      │                       │ Crank (ScheduleTask) · Magic program   │
└──────────────────────────────┘                       │ Explorer: cluster=custom&customUrl=ER  │
                                                        │ (add-on) TEE validator MTEWGuqx… for   │
                                                        │ sealed picks + attestation             │
                                                        └────────────────────────────────────────┘
```
There is **no game server, no database, no indexer**. State = chain accounts; reads = RPC + websocket; leaderboard = `getProgramAccounts` of committed Trainer accounts.

### 4.2 Module map (who owns what)
```
                         ┌──────────────────────┐
                         │   crates/duel-rules  │  no_std Rust: rules, House Agent, elo, replay
                         └───┬──────────┬───────┘
          (Rust dep, SBF)    │          │ (wasm-bindgen)
      ┌──────────────────────▼──┐   ┌───▼──────────────┐
      │ programs/pokestonksss   │   │ crates/duel-wasm │──► packages/rules-wasm
      │ Anchor: state, ix, VRF, │   └──────────────────┘            │
      │ oracle, crank, sessions,│                                    │
      │ sealing                 │                                    │
      └───────────┬─────────────┘                                    │
        IDL (anchor build)                                           │
      ┌───────────▼──────────────────────────────────────────────────▼──┐
      │ packages/sdk (TS): connections, PDAs, ix builders, subscriptions,│
      │ session keys, TEE auth (add-on), faucet client, explorer links   │
      └───────────┬───────────────────────────────┬─────────────────────┘
      ┌───────────▼──────────┐          ┌─────────▼──────────┐
      │ apps/web (Next+Phaser)│          │ scripts/ (Node/TS) │
      │ game, UI, /api/drip   │          │ e2e, judge-selftest │
      └──────────────────────┘          │ loadtest, deploy    │
                                         └────────────────────┘
```
Dependency rule: `duel-rules` depends on nothing; everything else may depend on it. TS never re-implements rules — it calls the WASM build (parity by construction); Rust-vs-TS fixture tests exist only for the thin TS fallback.

### 4.3 Repository layout (new repo `pokestonksss`, pnpm + cargo workspaces, `just` task runner)
```
pokestonksss/
├─ Cargo.toml                    # [workspace] members: programs/*, crates/*
├─ Anchor.toml                   # cluster=devnet, program id, [toolchain]
├─ justfile                      # just build|test|deploy|e2e|dev|fixtures|train
├─ package.json  pnpm-workspace.yaml  .gitignore (keys, target, .env*, test-ledger)
├─ .claude/skills/magicblock/    # MagicBlock AI Dev Skill (copied from ~/PokeStonks/.claude/skills/magicblock)
├─ programs/pokestonksss/src/
│    lib.rs  state.rs  errors.rs  consts.rs  oracle.rs  vrf.rs  crank.rs  seal.rs
│    ix/{onboard,practice,duel,pick,roll,settle,timeout,commit}.rs
├─ crates/duel-rules/            # src/{lib,types,roster_data(GEN),chart,damage,resolve,bot,elo,replay}.rs  tests/  examples/balance.rs
├─ crates/duel-wasm/             # wasm-bindgen exports (resolve_turn, replay, preview_damage, roster)
├─ rules/                        # roster.json (source of truth) + fixtures/*.json (generated by Rust)
├─ packages/sdk/                 # src/{connections,pda,accounts,ix,tx,subscribe,tee,session,faucet,explorer,latency,types}.ts
├─ packages/rules-wasm/          # built wasm + index.ts wrapper (+ pure-TS fallback in src/fallback)
├─ apps/web/                     # Next 16 app (see §6)
├─ scripts/                      # e2e-practice.ts e2e-duel.ts judge-selftest.ts loadtest.ts deploy-devnet.sh (USER-RUN) set-vercel-env.sh (USER-RUN)
└─ docs/                         # SYSTEM-ARCHITECTURE.md BUILD-PLAN.md OVERVIEW.md RULES.md GTM.md README-submission.md
```

### 4.4 End-to-end flows
**(a) Onboarding (once per browser, ≈3–4 s)**
```
Browser                       /api/drip              Solana devnet (base)                ER (Asia)
   │ gen guest keypair           │                         │                               │
   ├──POST pubkey───────────────►│ rate-limit (IP+pubkey)  │                               │
   │                             ├─transfer 0.03 SOL──────►│                               │
   │◄────────ok──────────────────┤                         │                               │
   ├─tx1: onboard (init Trainer + Arena PDAs)─────────────►│                               │
   ├─tx2: delegate_trainer + delegate_arena (validator MAS1Dt9q…)──►│── clone accounts ───►│
   ├─poll router getDelegationStatus / ER getAccountInfo until cloned ◄──────────────────────┤
   ▼ ready: UI shows "Wristband ready ✓" with explorer links for tx1/tx2
```
**(b) Practice battle (one human tx per turn)**
```
t0 tap Practice → ER tx start_practice(species) ─► Arena{phase=PICKING, seat1=HouseAgent, snap prices}   [chip: "Started in 0.4 s"]
turn:  player ER tx lock_pick(slot)  (includes VRF request accounts)
          program: store pick; bot picks (policy table, uses ONLY its own state + public opp stats + arena rnd seed, never the human pick)
          → CPI request randomness (ER queue) ──► VRF oracle ──► callback_turn(randomness, for_turn)
          callback: parse 2 oracle feeds → mood; rules::resolve_turn(...); append TurnRec; if KO → settle Trainer(s), phase=FINISHED
client: subscribes to Arena account over ER websocket (+2 s poll fallback) → animates events from the new TurnRec
end:    every Nth battle (or on "Save") → commit_trainer ER tx → base-layer commit sig shown as "Saved ✓"
```
**(c) Duel via link**
```
Host: open_duel(species, sha256(token))  → Arena{WAITING}; UI shows https://<site>/d/<hostArena>#<token> + QR
Guest opens link → guest key + drip + onboard (if new) → join_duel(species, token) (1 ER tx; checks hash; seats guest; phase=PICKING; arms crank timeout)
turn:   each player commit_pick(sha256(pick||salt))  →  when both committed phase=REVEALING
        each player reveal_pick(pick, salt)          →  2nd reveal triggers VRF request → callback_turn resolves
timeout: crank timeout_turn (iterations 2, deadline check) forces default GUARD; 2 timeouts = forfeit
```
**(d) Verify page** `/verify/<arena>`: fetch finished Arena (base layer after commit, or ER), run `rules-wasm.replay(log)`, compare HP/winner; list every roll: `rnd[8]` per turn, picks, mood.

### 4.5 State machine (Arena.phase)
```
IDLE ──start_practice──► PICKING(practice) ──lock_pick──► ROLLING ──callback_turn──► PICKING … ──KO/MAX_TURNS──► FINISHED
IDLE ──open_duel────────► WAITING ──join_duel──► PICKING(duel) ──both commit──► REVEALING ──both reveal──► ROLLING ──callback──► …
WAITING ──cancel/expired──► IDLE        FINISHED ──reset (next start_*)──► IDLE
any live phase ──crank timeout×2 / forfeit──► FINISHED
```

---------------------------------------------------------------------------------------------------
## 5. On-chain program (`programs/pokestonksss`)

### 5.1 Toolchain & versions [COMPILED in spikes]
Rust program: `anchor-lang = "1.0.2"` (resolves 1.2.1; `=1.0.2` also builds), `ephemeral-rollups-sdk = "0.16.2"` features `["anchor","vrf"]` (+`"access-control"` for PER add-on), `session-keys = "3.1.1"` (feature `no-entrypoint`), `magicblock-magic-program-api = "0.10.1"`, `bincode = "1.3"`, `solana-sha256-hasher = "3"` (Anchor 1.x no longer re-exports hash). Build: `anchor build` with anchor-cli 0.32.1 works (warns on version mismatch); SBF compiler = platform-tools v1.52 (rustc 1.89-dev). If platform-tools download times out: manual curl to `~/.cache/solana/v1.52/` (steps in `build-recipe-er.md` §1). **Note:** `avm install 1.0.2` silently switches the global default — restore with `avm use 0.32.1`. `ephemeral-vrf-sdk` 0.3.0 is yanked (SDK 0.16.2 pulls 0.4.1). Program ≈ 420–560 KB → devnet rent ≈ 2.1–2.9 SOL (5,080 lamports/byte); each upgrade needs a same-size buffer temporarily.

### 5.2 Accounts
| Account | Seeds | Size (≈) | Layer | Fields |
|---|---|---|---|---|
| `Trainer` | `["trainer", owner]` | ~96 B | delegated at onboarding | owner, name_seed u32, rating u16, wins u16, losses u16, streak u8, dex_mask u16, battles u32, unsaved u8, commits u8, bump |
| `Arena` | `["arena", owner]` | ~720 B | delegated at onboarding | host, mode, phase, turn, seat[2]{player, species, hp, max_hp, flags(charged,last_guard), commit[32], pick, revealed}, vrf_pending, token_hash[32], snap_price[2]{price i64, publish_time i64}, mood[2] i8, timer{deadline i64, task_id i64, timeouts[2]}, winner, log[16]{picks[2], rnd[8], hp[2], mood[2], flags} (17 B each), bump |
Both are per-player and **reused** (no per-battle account creation → no base-layer work on the hot path). A duel uses the **host's** Arena; the guest only supplies their Trainer.

### 5.3 Instructions
| Layer | Ix | Signer | Accounts | Notes |
|---|---|---|---|---|
| base | `onboard` | player | trainer, arena (init), system | rent ≈ (96+720)·5,080 ≈ 4.1M lamports |
| base | `delegate_trainer`, `delegate_arena` | player | pda(del), buffers…, validator in `remaining_accounts[0]` | `#[delegate]` macro; both in one tx; validator = Asia `MAS1Dt9qreoRMQ14YQuhg8UTZMMzDdKhmkZMECCzk57` |
| ER | `start_practice(species, tier)` | player | arena, trainer, feed×2 (oracle PDAs) | seats House Agent, snapshots prices |
| ER | `open_duel(species, token_hash)` / `cancel_duel` | host | arena, trainer, feed | |
| ER | `join_duel(species, token)` | guest | host arena, guest trainer, feed | verifies sha256(token)==hash; arms crank |
| ER | `lock_pick(slot)` (practice) | player | arena, vrf accounts | bot picks inside; requests VRF |
| ER | `commit_pick(hash)`, `reveal_pick(slot, salt)` (duel) | player | arena (+vrf on 2nd reveal) | sealing mode `SEAL_MODE=commit_reveal` |
| ER | `callback_turn(randomness, for_turn)` | VRF oracle (identity PDA) | arena, trainer0, trainer1, feed0, feed1 | `#[vrf_callback]`; idempotent (ignores stale/duplicate) |
| ER | `timeout_turn` | crank signer PDA | arena | `ScheduleTask` iterations=2 (first firing is immediate no-op) |
| ER | `forfeit` | player | arena, trainers | |
| ER | `commit_trainer` / `save_and_leave` | player or session | trainer (+arena) | `MagicIntentBundleBuilder`; batch every 3rd battle (10-commit cap) |
Auth on player ix: `#[session_auth_or(owner == signer, SessionError::InvalidToken)]` so wallet users can sign with a session key; guests sign directly.

### 5.4 Randomness (fair + unpredictable)
- One VRF request per turn from the **delegated ER queue** `5hBR571xnXppuCPveTrctfTU7tJLSN94nq7kv7FRK5Tc` (base queue `Cuj97ggr…` for base-layer requests). Request is issued in the same tx as the **last lock/reveal**, so outcome is unknowable before both picks exist. Oracle must answer in a later slot (`OracleMustProvideInDifferentSlot`). Callback authenticated by `#[vrf_callback]` (scoped identity PDA `["identity", program]`). Doc claim ~100 ms; local oracle callback measured 1,152 ms on base [RAN-LOCALLY]; ER timing [UNVERIFIED → gate G1.4].
- `rnd` byte usage: [0..1] accuracy A/B · [2..3] crit · [4..5] variance · [6] speed tie · [7] final tie-break · [8..9] bot exploration/choice.
- **Encounter fairness:** on route entry request one VRF seed; the client computes `encounter(step) = sha256(seed‖routeId‖step)[0] < 28` (≈11%) — verifiable by anyone, zero tx per step.

### 5.5 Oracle "weigh-in" [LIVE/COMPILED, `build-recipe-per-oracle.md` §C]
Feed accounts = PDAs of `PriCems5tHihc6UDXDjzjeawomAwBduWMGAi8ZUjppd` with seeds `["price_feed","pyth-lazer","<id>"]`. Devnet ids/addresses: **SOL 6** `ENYwebBThHzmzwPLAQvCucUTsjyfBSZdD9ViXksS4jPu` · **BTC 1** `71wtTRDY8Gxgw56bXFt2oc6qeAbTxzStdNiC425Z51sr` · **ETH 2** `5vaYr1hpv8yrSpu8w3K95x22byYxUJCCNCSYJtqVWPvG` · **SUI 11** `5WLZBMYdJ9PyNLEVxUumz9XZ11446L6dEPHGkPGehJ2j` · **ZEC 66** `6XWQr2Y1XEpJrCdVbYGupnDeb3wkR4YXazVXdgn2Lwpg` · **BNB 15** `BYcDWZKZcGo8y3252xkK9ZrLoRoeMFaixWD6SoeW12fs` · **DOGE 13** `Gi5NTTpv9bzBQTgjKyqczJPtSbH1ojebLFgRrP3JKZYZ` · **XRP 14** `6ghNHfjf5YP1aKtpAfdHK1KrtKEm5Ww6SaDffDTxf5xX`. Layout (134 B): disc `[234,161,14,36,172,239,15,232]` (PriceUpdateV3), price i64 @73, **exponent i32 @89 = +8**, publish_time i64 @93 (seconds). **Parse by hand** (Pyth SDK parse fails); validate address == PDA(seeds), disc, verification_level==1, `|now−publish_time| ≤ 10 s` else mood = 0. Cadence: majors 50 ms (~20 updates/s), others 200 ms. Base-layer copies are stale → read on the ER only. TEE devnet oracle had downtime on 2 prior days → mood is **best-effort**, UI shows "oracle idle".
Mood: at bell store `snap_price`; per turn `mood = sign(price_now − snap)` with a 0.01% dead-band → +1/0/−1 ⇒ ×1.10 / ×1.00 / ×0.90 damage.

### 5.6 Sealing modes (feature flag)
- **`commit_reveal` (default, GO)** public ER; picks hidden until reveal via sha256 commitment; timeouts by crank. Fully explorable. [COMPILED]
- **`per` (add-on, RISKY)** Match + per-player Pick accounts delegated to TEE `MTEWGuqxUpYZGFJQcp8tLN7x5v9BSeoFHYWQQ3n3xzo`; permission program **`ACLseoPoyC3cBqoUtkbjZ4aDrkurZW86v19pXz2XQnp1`** (not `BTWAq…`, legacy); members derived **on-chain**; `lock_pick` requires a private owner-only permission; `resolve_turn` slot-gated; client auth via `verifyTeeRpcIntegrity` + `getAuthToken` (works live: 1.9 s / 0.37 s); non-members read `null`; TEE block endpoints are 403 so the **committed Match log is the audit trail**. VRF on TEE-delegated accounts: request on base before delegating, mix sealed nonces into the roll (`roll = sha256(seed‖turn‖moveA‖moveB‖nonceA‖nonceB)`). Reference: `spikes/per` (48 KB program, 6 tests), `build-recipe-per-oracle.md` §1–2.

### 5.7 Crank (turn timeouts) [COMPILED, firing UNVERIFIED]
`ScheduleTask{task_id, execution_interval_millis: 30_000, iterations: 2, instructions:[timeout_turn]}` signed by the Arena PDA; **a new task fires immediately** (validator 1.0.0) so execution #1 must be a no-op and #2 applies the timeout after checking `now ≥ deadline && turn matches`. `task_id` derived from the arena key (validator-global). `commit_frequency_ms` is ignored by the validator. Code: `spikes/er-vrf/programs/er-vrf/src/lib.rs` (`schedule_turn_timeout`, `cancel_turn_timeout`, `timeout_turn`).

### 5.8 Rewards without a claim button
Trainer is delegated with the Arena. `callback_turn` on KO updates both Trainers (rating via integer Elo, wins/losses/streak, dex_mask bit for defeated species, battles, unsaved+1). `commit_trainer` (client-triggered after every 3rd battle or "Save") calls `MagicIntentBundleBuilder::commit` (call `exit()` on mutated accounts first). UI shows "Saved to Solana ✓ <sig>". Cap: 10 commits/account without fee-payer vault → on the 9th commit use `commit_and_undelegate`, then client re-delegates in the background (Phase 10). Magic Action–based prize push is Tier 3.

### 5.9 Security checklist (must be tests in Phase 10)
VRF only requested after both locks · callback idempotent + bound to `for_turn` · bot function signature cannot see the human pick · join token stored as hash only · all ix check account owners/seeds/phase · session token scope = this program, expiry ≤ 1 day · oracle feed identity/freshness validated · integer overflow checks (`overflow-checks = true`) · no `msg!` of secrets · upgrade authority = deployer key held off-repo · crank-only ix requires crank signer PDA · rematch cannot reset a live arena (only IDLE/FINISHED).

### 5.10 Budgets
Per new guest: rent ≈ 4.1M lamports + two delegation deposits (measured 3,138,960 lamports each) + fees → **drip 0.03 SOL**; faucet wallet 4 SOL ⇒ ≈130 guests (top up via devnet faucet). Program deploy ≈ 2.1–2.9 SOL one-off (deployer ≥ 6 SOL recommended for upgrades).

---------------------------------------------------------------------------------------------------
## 6. Client & frontend

### 6.1 `packages/sdk` (TypeScript)
Modules: `connections` (base `https://rpc.magicblock.app/devnet` or api.devnet; ER `https://devnet-as.magicblock.app` + `wss://`; router `https://devnet-router.magicblock.app/` for `getDelegationStatus` only), `pda`, `accounts` (Anchor coder from generated IDL), `ix` (builders), `tx` (send to ER: `skipPreflight:true`, ER blockhash, confirm via subscription), `subscribe` (WS account sub + 2 s poll fallback), `session` (**manual SessionTokenV2** creation — gum-react-sdk makes V1 tokens, programs need V2), `tee` (add-on), `faucet` client, `explorer` (`https://explorer.solana.com/tx/<sig>?cluster=devnet` and `?cluster=custom&customUrl=<ER RPC>`), `latency` (rolling p50/p95 of tx confirm time for the chips), `types`. Versions that typechecked: `@solana/web3.js 1.98.4–1.99.0`, `@coral-xyz/anchor 0.32.1`, `@magicblock-labs/ephemeral-rollups-sdk 0.17.3`, `tweetnacl`, `bs58`.

### 6.2 Game engine (`apps/web`, ported from our own PokeStonks code)
Stack identical to PokeStonks: Next 16.3.x (**read `node_modules/next/dist/docs` — APIs differ**), React 19.2, Tailwind 4, Phaser **~3.80.1** + grid-engine **2.45.0** (exact), MapLibre GL 6 (worker copy script `scripts/copy-maplibre-worker.mjs` is mandatory), zustand, howler, `@fontsource/press-start-2p`. Gotchas to keep: `import * as Phaser from 'phaser'`; MapLibre CSS overrides Tailwind positioning (inline style); global `.btn` beats utilities (use `!`); never let identity flip to "loading" mid-flow.
Port map (source `~/PokeStonks/apps/web/app/game`):
| Unit | Lines | Treatment |
|---|---|---|
| `audio/*` (engine, music, sfx, voices) | ~2.3k | copy as is; add 2 new tracks (fair-night title, battle variant) |
| `art/pixel.ts, paint.ts, monkit.ts, characters.ts, tileset.ts, tileProps.ts, themes.ts, battle.ts` | ~1.9k | copy; retheme palettes per route |
| `art/species/*` | ~0.5k | **rewrite**: 8 new BrokerMon via the same `MonCtx` kit |
| `overworld/*` (maps, controls, hud, dialog, cutscene) | ~1.7k | copy; re-skin `maps.ts` to 8 routes; trainer lines unchanged |
| `scenes/{Boot,Preload,Overworld}Scene` | ~0.8k | adapt (asset keys, species registry) |
| `scenes/BattleScene.ts` + `battle/{menu,plates,dialog,fx,end,ui,turns}` | ~1.6k | adapt: replace `game-core` types with `rules-wasm` types; replace `net/session` with `BattleSource`; remove tap-timing bar and claim UI |
| `net/session.ts`, `flow/*`, `web3/*`, `components/ConnectWalletDialog,ClaimLayer,NftCard` | ~1k | **delete/replace** (Colyseus, wagmi, claim) |
| `components/{Title,BrokerSelect,Hud,Globe,MarketPins,Toasts,ui}` | ~2k | adapt; Globe pins = 8 routes with live oracle price |
New UI: Onboarding "Wristband" overlay, Duel invite (link + QR), Weigh-in strip, **Proof Strip**, Peek-Proof button (add-on), Trainer Card + BrokerDex, Judge page `/judge`, Verify page `/verify/[arena]`, latency/chain badges ("LIVE · EPHEMERAL ROLLUP · devnet").
**`BattleSource` interface** (`getSnapshot()`, `subscribe(cb)`, `lock(slot)`, `commit(slot)`, `reveal()`, events as `TurnEvent[]`) with `LocalBattleSource` (WASM rules, offline) and `ChainBattleSource` (ER). The whole battle UI is built and tested against Local first.

### 6.3 Design-fidelity rule (user requirement, memory `feedback-visual-fidelity`)
Visual parity with PokeStonks is a **gate**: full-screen canvas, ~3× camera following the player, dense 48×36 procedural routes, navy/gold HUD panels with Press Start 2P, procedural music. Before any UI phase is "done": screenshot new vs `https://pokestonkss.vercel.app` side by side (Playwright) and fix differences. Never ship placeholder rectangles.

---------------------------------------------------------------------------------------------------
## 7. House Agent & balance tooling (no ML)
**House Agent (on-chain bot).** A deterministic heuristic in `duel-rules::bot_pick(state, side, rnd)`; its signature cannot even accept the human's pending pick, so it provably never peeks. Score per slot: STRIKE = accuracy × expected damage (type × STAB, no variance) vs. the opponent's *public* stats; GUARD gets a bonus when own HP < 40% or the opponent is `charged`; CHARGE gets a bonus when own HP > 60% and the opponent just guarded. Difficulty tiers = exploration noise: Rookie 50% random, Pro 25%, Champion 10% (random pick uses `rnd[8..9]`). Always labelled "House Agent" in the UI.
**Balance tooling.** `cargo run -p duel-rules --example balance --release` simulates all 64 ordered pairings × ≥2,000 seeded fights with the bot policy; tune `rules/roster.json` until every BrokerMon wins 42–58% overall, no matchup exceeds 70%, and average length is 5–9 turns. Pure Rust, seconds on CPU.
**Explicitly out of scope:** machine learning, GPU work, W&B, agent/MCP servers, learned policies — none of it helps the MagicBlock judging criteria.

---------------------------------------------------------------------------------------------------
## 8. Tech stack & why (multi-language on purpose)
| Concern | Choice | Why |
|---|---|---|
| On-chain program | **Rust + Anchor 1.x** | required by SDK; integer determinism; session/VRF/crank macros |
| Rules engine | **Rust `no_std` crate** shared by program, WASM, sim | one source of truth, no drift, fast |
| Browser rules | **Rust→WASM** (`wasm-bindgen`/`wasm-pack`; needs `rustup target add wasm32-unknown-unknown` + `cargo install wasm-pack` — not installed yet) | replay/preview identical to chain; fallback = TS port verified by fixtures |
| Client SDK, scripts, faucet API | **TypeScript (Node 22, pnpm 10)** | web3.js/anchor ecosystem, shares types with web |
| Game/UI | **Next 16 + React 19 + Phaser 3.80 + grid-engine + MapLibre + Tailwind 4** | proven in PokeStonks; fidelity |
| Task runner / CI | `just`, GitHub Actions (cargo test, vitest, tsc, anchor build) | speed, reproducibility |
| Testing | cargo test, vitest, Playwright, Node devnet e2e, k6-style Node loadtest | see §10 |
Host: 12 cores, 15 GB RAM, Node 22.23, pnpm 10.28, rustc 1.99, solana-cli 3.1.13, anchor-cli 0.32.1, `just` present.

---------------------------------------------------------------------------------------------------
## 9. Infra, environment, keys
- **Cluster:** Solana devnet. Base RPC `https://rpc.magicblock.app/devnet`. ER region **Asia**: `https://devnet-as.magicblock.app` (measured 0.22 s total from India vs EU 0.41, US 0.62); TEE Asia `devnet-tee-as.magicblock.app`. Status: `https://status.magicblock.app/api/services` (all devnet services live 2026-10-12; TEE has no router).
- **Program ids:** Delegation `DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh`; Magic `mAGicPQYBMvcYveUZA5F5UNNwyHvfYh5xkLS2Fr1mev`; validators Asia `MAS1Dt9qreoRMQ14YQuhg8UTZMMzDdKhmkZMECCzk57`, EU `MEUGGrYPxKk17hCr7wpT6s8dtNokZj5U2L57vjYMS8e`, US `MUS3hc9TCw4cGC12vHNoYcCGzJG1txjgQLZWVoeNHNd`, TEE `MTEWGuqxUpYZGFJQcp8tLN7x5v9BSeoFHYWQQ3n3xzo`. Our program id: generated at first build (`target/deploy/*-keypair.json`, gitignored; id recorded in `Anchor.toml` + README).
- **Env (web):** `NEXT_PUBLIC_CLUSTER=devnet`, `NEXT_PUBLIC_BASE_RPC`, `NEXT_PUBLIC_ER_HTTP`, `NEXT_PUBLIC_ER_WS`, `NEXT_PUBLIC_ROUTER`, `NEXT_PUBLIC_PROGRAM_ID`, `NEXT_PUBLIC_SEAL_MODE`; server-only: `FAUCET_SECRET_KEY` (JSON array, **dedicated low-balance wallet**), `DRIP_LAMPORTS=30000000`, `DRIP_MAX_PER_IP_PER_HOUR=6`, `FAUCET_FLOOR_LAMPORTS=500000000`.
- **Keys policy:** deployer key = file `~/.config/solana/blitz-deployer.json` (user imports via `! ~/bin/blitz-key-finish.sh`); never in repo/Vercel/commands. Faucet key = separate wallet (user imports `python3 ~/bin/import-solana-key.py`), loaded into Vercel by a **user-run** script `scripts/set-vercel-env.sh`. Deploy by **user-run** `scripts/deploy-devnet.sh` (the harness blocks agents from handling raw keys).
- **Hosting:** new Vercel project `pokestonksss` (root `apps/web`, include files outside root) → `pokestonksss.vercel.app`; GitHub repo `Abhishek222983101/pokestonksss` (public). No Render, no database.
- **Cost/limits:** devnet only; no real funds; labelled "devnet · simulated funds".

---------------------------------------------------------------------------------------------------
## 10. Verification

### 10.1 Test matrix
| Layer | Test | Gate |
|---|---|---|
| duel-rules | `cargo test`: chart (25 pairs), damage worked examples, guard/charge/vuln, order, tie-breaks, MAX_TURNS, bot determinism, elo | all green |
| parity | Rust generates ≥500 turn fixtures + ≥200 bot fixtures; WASM + TS fallback must match byte-for-byte | 100% |
| program | host unit tests; local-validator (base-only) e2e `client/e2e-base.ts` pattern; **devnet e2e** `scripts/e2e-practice.ts` / `e2e-duel.ts` | green on devnet |
| security | negative tests: wrong signer, wrong phase, stale callback, reused token, early reveal, forged feed | all rejected |
| SDK | vitest + tsc strict | green |
| UI | Playwright: fresh visitor → practice win in <90 s; duel with 2 contexts; reload mid-battle; mobile viewport | green + screenshots |
| fidelity | side-by-side vs pokestonkss | reviewed |
| load/chaos | 20 concurrent guest bots × 5 battles; kill network mid-turn; double-submit; faucet exhaustion | 0 unrecovered |

### 10.2 Performance targets (inference; measure and show, don't claim)
Practice tap→first selectable turn p50 < 1.0 s, p95 < 2.0 s; lock→resolved turn p50 < 1.2 s (VRF dominated); onboarding ≤ 4 s; Arena account ≤ 800 B; callback CU ≤ 200k.

### 10.3 Judge self-test (`/judge`)
One button: creates a guest, drips, onboards, plays a scripted practice battle end-to-end, then prints a checklist with explorer links: onboard tx, delegate tx, ER start tx, each lock tx, each VRF request + callback tx, commit tx, program ids, oracle feed addresses with live values, replay verification ✓. Target < 60 s.

### 10.4 Demo script (~170 s)
0:00 open page → Play as guest → "Started in 0.4 s" · 0:15 BrokerMon select, live prices · 0:30 enter route, grass encounter ("fair seed" chip) · 0:50 battle: sealed picks, Weigh-in, VRF roll chip · 1:20 win → "Saved ✓" no claim button · 1:35 second phone scans duel QR, joins in 2 taps · 2:05 Proof Strip + explorer (delegate/ER/VRF/commit) · 2:20 Verify page replay ✓ · 2:40 close (Colosseum angle: sponsored routes/booths + reusable sealed-turn + VRF-receipt engine).

---------------------------------------------------------------------------------------------------
## 11. Risks & fallbacks
| Risk | Likelihood | Mitigation / fallback |
|---|---|---|
| ER runtime behaviours unproven (delegated VRF on ER, crank firing, commit, session tx, unfunded guest) | **High** | Phase 1 is a go/no-go spike on devnet **before** anything else; fallbacks: faucet-funded guests; client-triggered timeout instead of crank; VRF requested on base layer if ER queue fails |
| Local ER cannot run (`ephemeral-validator` needs nofile 1M, root) | Certain | test on devnet only; unit-test rules offline |
| PER sealed picks (never run on a TEE) | Medium-High | add-on only (Phase 4b, time-boxed, kill criteria); commit-reveal default |
| Time: full plan ≫ hours left to 22:00 UTC | **High** | two targets: Blitz = best working slice (P0–P5 + minimal UI), Colosseum 06:59 UTC = full plan; decide with user |
| Oracle stale/down | Medium | mood=0 fallback, "oracle idle" badge |
| Devnet congestion/faucet drain | Medium | drip floor + per-IP limits, retry/backoff, queue UI |
| 10-commit cap | Medium | batch + undelegate/re-delegate path (P10) |
| Visual regression vs PokeStonks | Medium | fidelity gate every UI phase |
| Credential handling blocked by harness | Certain | user-run scripts; separate faucet wallet |
| Disclosure | n/a | README + Colosseum form state reused-engine lineage |

---------------------------------------------------------------------------------------------------
## 12. References (everything the build agent needs)

### 12.1 Local folders
| Path | What |
|---|---|
| `~/worlds-fair/` (to be renamed/pushed as `pokestonksss`) | new repo scaffold + these docs |
| `~/magicblock-blitz-research/CONTEXT-PACK.md` | master context; start here |
| `~/magicblock-blitz-research/build-recipe-er.md` | ER/VRF/session/crank recipe + versions + risks (compiled spike `spikes/er-vrf/`) |
| `~/magicblock-blitz-research/build-recipe-per-oracle.md` | PER sealed picks, oracle layout/feeds, rewards, lobby (spike `spikes/per/`) |
| `~/magicblock-blitz-research/docs-architecture.md` + `docs-pages/` (152 files) | full MagicBlock docs, grep with `rg` |
| `~/magicblock-blitz-research/repos/` | 14 shallow clones (ephemeral-rollups-sdk, magicblock-engine-examples, solana-vrf, session-keys, hydra, real-time-pricing-oracle, magicblock-dev-skill, bolt, …); query: `graft ask "<identifiers>" repos/<name>`; repo-map in `repo-map.md` |
| `~/magicblock-blitz-research/mechanics-research.md`, `README.md`, `winners-*.md`, `x-analysis.md`, `ecosystem-and-news.md`, `v9-brief-and-tech.md`, `demos/` | strategy, winners, MagicBlock narrative, UI benchmarks |
| `~/PokeStonks/` | source of reusable code: `apps/web/app/game/**`, `packages/game-core` (old rules for reference), `PokeStonks-ARCH-V4.md` (format reference), `PROJECT-BRIEF.md` |
| `~/PokeStonks/.claude/skills/magicblock/` | MagicBlock AI Dev Skill (SKILL.md + references/*.md) — copy into new repo |
| `~/Documents/sys archs/SATYACHECK_BLUEPRINT.md` | blueprint format reference |
| `~/bin/blitz-key-finish.sh`, `~/bin/import-solana-key.py` | user-run key import helpers |

### 12.2 Links
- MagicBlock docs: https://docs.magicblock.gg (index https://docs.magicblock.gg/llms.txt; every page fetchable as `.md`): ER quickstart `/pages/ephemeral-rollups-ers/how-to-guide/quickstart`; fees `/pages/ephemeral-rollups-ers/introduction/fees-and-commit-economics`; magic actions `/pages/ephemeral-rollups-ers/magic-actions/overview`; ephemeral accounts `/pages/ephemeral-rollups-ers/introduction/ephemeral-accounts`; VRF `/pages/verifiable-randomness-functions-vrfs/how-to-guide/quickstart`; PER `/pages/private-ephemeral-rollups-pers/how-to-guide/quickstart`; crank `/pages/tools/crank/implementation`; session keys `/pages/tools/session-keys`; oracle `/pages/tools/oracle/introduction`; AI dev skill `/pages/overview/additional-information/ai-dev-skill`.
- GitHub (org https://github.com/magicblock-labs): `ephemeral-rollups-sdk`, `magicblock-engine-examples` (roll-dice, rewards-delegated-vrf, session-keys, crank-counter, private-counter, rock-paper-scissor, sealed-auction, binary-prediction, oracle-priced-purchase, magic-actions), `magicblock-dev-skill`, `solana-vrf`, `session-keys`, `hydra`, `real-time-pricing-oracle`, `delegation-program`, `magicblock-validator`, `magic-router`.
- Hackathon: Luma https://luma.com/832wilvl · submit https://build.magicblock.app/?stage=blitz#submit · builders https://build.magicblock.app/builders · ideas https://build.magicblock.app/ideas · Colosseum https://colosseum.com/worldsfair · rules PDF (see §1.5) · https://colosseum.com/hackathon.
- Live reference game: https://pokestonkss.vercel.app · old repo https://github.com/Abhishek222983101/pokestonks (do not push there).
- Explorer: https://explorer.solana.com (cluster=devnet | custom ER URL) · status https://status.magicblock.app/api/services.

### 12.3 Reading order for the build agent
1. `CONTEXT-PACK.md` §0 (standing rules) → 2. this doc §1–5 → 3. `BUILD-PLAN.md` (execute phase by phase) → 4. `build-recipe-er.md` + `build-recipe-per-oracle.md` (code patterns, versions) → 5. `RULES.md` → 6. skill references (`delegation.md`, `vrf.md`, `cranks.md`, `session-keys.md`, `pricing-oracle.md`, `debugging.md`, `security.md`) → 7. PokeStonks code for the port.

### 12.4 Standing rules (copy of CONTEXT-PACK §0)
No building until the user says build · new repo + new Vercel link · MagicBlock priorities first · few subagents (token economy) · never handle raw keys (user-run scripts) · always disclose lineage · visual fidelity gate.
