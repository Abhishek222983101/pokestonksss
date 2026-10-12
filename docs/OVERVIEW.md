# PokeStonksss — human overview (read this one; the agent reads the other two)

## What we are building, in plain words
PokeStonks, rebuilt so that **MagicBlock's rollup is the game server**. You still pick a "BrokerMon" (now one per crypto asset: SOL, BTC, ETH, SUI, ZEC, BNB, DOGE, XRP), walk a pixel route, hit tall grass and get pulled into a 1v1. The difference is invisible to the player and obvious to a judge: every move runs on a MagicBlock Ephemeral Rollup, every dice roll is a MagicBlock VRF result you can verify, live prices from MagicBlock's oracle change the damage, and your rating is saved to Solana **without a claim button**. No server, so no cold start; the bot starts instantly.

## Why this wins (what MagicBlock judges look for)
Winners used the rollup + VRF/Private ER in a way the product can't live without, then proved it on an explorer and kept a live demo up. We do exactly that and make it visible: a **Proof Strip** under every battle (Weighed · Sealed · Rolled · Saved), a **Judge page** that self-tests in under a minute, and a **Verify page** that replays any finished match from chain data.

## The five ideas to keep in your head
1. **Two layers.** Solana (slow, permanent) and the rollup (fast, temporary). Your account is *delegated* to the rollup at onboarding; the game runs there; results are *committed* back to Solana in batches ("Saved ✓").
2. **Pre-built arena.** Each player gets one reusable battle slot at onboarding (~3–4 s, once). That is why "Practice" starts instantly later.
3. **Fair dice.** Both players lock their move first; only then do we ask the VRF for randomness. So nobody (including us) can know the roll in advance.
4. **Sealed picks.** Default: commit-then-reveal (hash first, reveal second). Add-on: Private ER, where the opponent's pick is unreadable and a "Peek-Proof" button shows the denial.
5. **One rules engine.** The same Rust code runs on-chain, in your browser (WASM) and in tests, so the chain and the screen can never disagree.

## How a battle works
Types form a pentagon (×2 / ×½). Each BrokerMon has 4 moves: two Strikes (**Pump**), **Hedge** (guard) and **Leverage** (charge). Picks are simultaneous: Pump beats Leverage, Leverage beats Hedge, Hedge beats Pump. Live price moves since the bell add ±10% damage ("market mood"). HP is called **Margin**; a KO is "Liquidated". Matches last ~5–8 turns. Ranks climb Shrimp → Crab → Dolphin → Shark → Whale.

## The code, by importance
| Where | Why it matters |
|---|---|
| `programs/pokestonksss/` | The on-chain game. Accounts `Trainer` + `Arena`; instructions for onboarding, practice, duel, picks, VRF callback, timeouts, commit. If this breaks, nothing works. |
| `crates/duel-rules/` | The rules (damage, types, bot, Elo, replay). Pure Rust, integer math. Everything else depends on it. |
| `packages/sdk/` | How the browser talks to Solana and the rollup (connections, transactions, subscriptions, explorer links). |
| `apps/web/` | The game you see: Phaser world + React UI. Ported from PokeStonks; must look and feel the same. |
| `scripts/` | Devnet end-to-end runs, the judge self-test, load tests, and the user-run deploy scripts (the only place keys are touched). |

## Phases (what happens, in order)
- **P0 Foundations** — new repo, tools, CI, your keys (you run one command).
- **P1 Chain spike (hardest, first)** — prove on real devnet: delegation, rollup speed, VRF on the rollup, the timer crank, commits, oracle reads, whether a guest with no SOL can play. Anything that fails gets a fallback *before* we build on it.
- **P2 Rules** — Rust rules + WASM + tests + balance so no BrokerMon dominates.
- **P3 Practice battle on-chain** — the backbone; this alone is a valid Blitz entry.
- **P4 Duel by link** — friend joins in two taps; timeouts handled by the crank.
- **P4b Private ER (optional)** — time-boxed 90 min; dropped if it doesn't work.
- **P5 SDK + onboarding + faucet** — free devnet SOL for guests so judges never need a wallet.
- **P6 Frontend port** — the PokeStonks look, rebranded, running offline first.
- **P7 Chain-wired UI** — Proof Strip, weigh-in, duel UI, trainer card, Judge and Verify pages.
- **P8 Art & audio** — 8 new BrokerMon sprites, 2 new tracks, logo.
- **P9 Hardening** — chaos, load, security tests so nothing breaks while judges play.
- **P10 Deploy & submit** — new Vercel link, README with the lineage disclosure, two videos, both forms.
- **P11 Stretch** — quick-match, wallet login, share card, more BrokerMon.

No machine learning, no GPU, no extra paid APIs. The only things you provide: the two key imports, a Vercel login, and the form logins (Telegram for MagicBlock, Colosseum account).

## What can go wrong (and what we do)
- **Rollup behaviours we couldn't test locally** (VRF on the rollup, crank, commits, unfunded guests) → P1 tests them first, with fallbacks ready.
- **Private ER** is new and risky → it's an add-on with a kill switch.
- **Time** → the Blitz deadline (22:00 UTC) allows only the Blitz slice; the full game targets Colosseum (06:59 UTC next day).
- **Look and feel** → each UI phase must pass a side-by-side screenshot check against the live PokeStonks.

## Honesty notes
Colosseum requires disclosing reused code, so the README and form say the engine/UI came from our Monad prototype; the Solana/MagicBlock layer is new. The oracle only has crypto feeds (no stocks), which is why the creatures are crypto assets now.
