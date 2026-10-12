# Duel rules (source of truth for Rust + TypeScript) — "champions" = BrokerMon; UI vocabulary: Strike=Pump, Guard=Hedge, Charge=Leverage, HP=Margin, KO=Liquidated

Everything here is **integer math, fully deterministic given (state, picks, rnd, mood)**. The on-chain program
(`crates/duel-rules`, used by the Anchor program) and the client (`packages/rules`) must produce byte-identical
results; `rules/fixtures/*.json` is run by both test suites.

## Constants
- Level is fixed (no levels). `MAX_TURNS = 16`. Percent/permille factors only; floor division after every step.
- Types (5, index order): `0 SPEED  1 ARMOR  2 ARCANE  3 TIDE  4 SHADE`.
  `eff(att, def)`: `d = (def - att + 5) % 5` → `d==0` 100 (neutral) · `d==1||d==2` 200 (super) · `d==3||d==4` 50 (resisted).
  Every type is strong vs two types and weak vs two types.

## Champions (8) — data lives in `rules/roster.json`
Each: `id, name, asset (oracle ticker), type, hp, atk, def, spd, moves[4]`.
Move slots: `0 Signature STRIKE (own type)`, `1 Coverage STRIKE (other type)`, `2 GUARD`, `3 CHARGE`.
Target HP ≈ 140–180, strike damage ≈ 25–35 neutral so a match lasts ~5–8 turns.
Roster covers every type at least once. **Balance requirement:** a simulator (bot-vs-bot, all 64 ordered
pairings, ≥2000 seeded fights each) must show every champion's overall win-rate within 42–58%.

## Actions
- `STRIKE(type, power, acc%)`: deals damage if the accuracy roll passes.
- `GUARD`: this turn incoming STRIKE damage ×20% (×50% if GUARD was also used last turn); heals 10% max HP
  at start of turn (no heal if used last turn).
- `CHARGE`: no damage; sets `charged`. Next STRIKE (hit or miss) consumes it: ×2.0 damage. While charging the
  user is **vulnerable**: incoming STRIKE damage ×1.3 that turn.
  → rock-paper-scissors triangle layered on types: STRIKE beats CHARGE, CHARGE beats GUARD, GUARD beats STRIKE.

## Damage (integer)
```
base   = floor(floor(22 * power * atk / def) / 50) + 2
dmg    = base
dmg    = dmg * stab%/100          (stab = 125 if move.type == champion.type else 100)
dmg    = dmg * eff%/100
dmg    = dmg * variance%/100      (variance = 85 + rnd_var % 16)
dmg    = dmg * crit%/100          (crit = 150 if rnd_crit < 16 (≈1/16) else 100)
dmg    = dmg * mood%/100          (mood: bull +1 → 110, flat 0 → 100, bear −1 → 90, from live oracle price move)
dmg    = dmg * charge%/100        (attacker.charged → 200)
dmg    = dmg * guard%/100         (target guarded: 20 or 50; else 100)
dmg    = dmg * vuln%/100          (target charging this turn → 130)
dmg    = max(dmg, 1)
```
Floor after each multiplication. Accuracy: hit iff `rnd_acc % 100 < acc`.

## Turn resolution
1. Picks `p[0], p[1]` ∈ {0..3}. Apply GUARD heals. Apply CHARGE flags.
2. Strikes resolve in order of higher `spd` first (tie → `rnd[6] & 1`). If a strike KOs, the other strike this turn does not happen.
3. `turn += 1`. If a side is at 0 HP → it loses. If `turn == MAX_TURNS` with both alive → higher `hp*1000/max_hp` wins (tie → `rnd[7] & 1`).
4. Output: new state + event list (`miss`, `hit{dmg,crit,eff}`, `guard`, `charge`, `ko`, `mood`) for UI animation and for replay.

## Randomness (32 bytes per turn, from MagicBlock VRF)
`rnd[0]` acc side0 · `[1]` acc side1 · `[2]` crit side0 · `[3]` crit side1 · `[4]` variance side0 · `[5]` variance side1 ·
`[6]` speed tie · `[7]` final tie-break · `[8]` bot exploration roll · `[9]` bot random move.

## House Bot (on-chain opponent)
Chooses its pick **before** looking at the human's pick (never peeks; guaranteed by code structure).
For each of its 4 slots compute a score: STRIKE = expected damage (acc × dmg with eff/STAB, no variance) vs. the
opponent's public stats; GUARD = bonus when own hp% < 40 or opponent `charged`; CHARGE = bonus when own hp% > 60
and opponent just guarded. 25% of the time (`rnd[8] < 64`) pick uniformly (`rnd[9] % 4`) instead. Deterministic given rnd.

## Rating
Elo with integer math, K=24, start 1000, stored per Trainer. Draws impossible (tie-breaks above).

## Replay / verification
Each finished match stores a compact log: per turn `picks[2], rnd[8 bytes], hp[2], mood[2], flags`. A pure TS verifier
re-simulates the full match from `(champions, picks, rnd, mood)` and compares final HP/winner to the on-chain
state: "don't trust us — replay it".

## Clarifications (P2 implementation, authoritative where they differ from the text above)
- **Randomness bytes used = `rnd[0..10]` only.** `[0]/[1]` accuracy s0/s1 · `[2]/[3]` crit · `[4]/[5]` variance · `[6]` speed tie · `[7]` final tie-break · `[8]` bot explore roll · `[9]` bot random move. `resolve_turn` takes `&[u8;32]` but ignores bytes 10..32; the on-chain log stores only `rnd[0..10]` (10 bytes) and `replay` takes `rnd[10]` per turn. Log entry per turn = `picks[2] | rnd[10] | mood[2]` (14 bytes, `TURN_LOG_BYTES`).
- **House Agent tiers:** explore when `rnd[8] < 128` (Rookie, 50%), `< 64` (Pro, 25%), `< 26` (Champion, ~10%); then slot = `rnd[9] % 4`. Otherwise greedy with ties to the lowest slot. `bot_pick(state, side, rnd, tier)` has no parameter for the other side's pick. The VRF is requested after picks lock, so the program calls `bot_pick` in the callback with the fresh `rnd`, immediately before `resolve_turn`; the signature still prevents peeking. Bot scores (units: acc% x expected damage): STRIKE as in the text (capped at the opponent's remaining HP, doubled if the bot is charged); GUARD 0 (+1500 if own HP < 40%, +3000 if opponent charged; 0 if it guarded last turn); CHARGE 0 if already charged, else 600 (+4500 if own HP > 60% and opponent guarded last turn).
- **Mood:** `mood[i]` scales the attacks of side `i` (110/100/90 by sign; magnitude beyond 1 is clamped). A `mood` event is emitted at turn start for each side with non-zero mood.
- **Guard:** the 20%/50% multiplier applies to STRIKEs that turn; the heal (10% of max HP, floor, capped at max) happens in step 1 before any strike and is skipped when GUARD was used the previous turn. `last_guard` is recorded each turn (true iff the side picked GUARD).
- **Charge:** `charged` persists until that side's next STRIKE (hit or miss). Picking CHARGE while already charged is allowed (no stacking). The vulnerable x1.3 applies only on the turn the target picked CHARGE.
- **Reported damage:** `hit.dmg` is the HP actually removed (clipped to the target's remaining HP). `hit.eff` is 50/100/200. `ko.side` is the fighter liquidated. `end{winner,byKo}` closes the match.
- **Turn limit:** `turn += 1` after each turn; at `turn == 16` with both alive the higher `hp*1000/max_hp` (floor) wins, tie -> `rnd[7] & 1` (0 = side 0). A KO on the final turn is a KO.
- **Invalid input** (pick > 3, finished match, invalid species): `resolve_turn` returns no events and does not mutate state.
- **Elo:** expected score from a 17-point integer table (rating diff 0..800 in steps of 50, linear interpolation, clamped at +-800); winner gains `max(1, 24*(1000-E)/1000)` (floor), loser loses the same, floored at 0 rating.
- **Replay** returns `Outcome{winner,hp[2],turns}` or an error: `bad_species`, `bad_pick`, `too_long` (> 16 entries), `unfinished`, `trailing_turns`.
- **Coverage design rule:** each BrokerMon's coverage move is type `own+2 (mod 5)`, the one type that is super-effective against both of its counters, so no matchup is a hard counter.

## Momentum (added 13 Oct 2026)
Each fighter has Momentum 0..3 (stored in bits 1–2 of its `last_guard` state byte, so account layouts did not change). After every turn: if your pick *out-reads* the opponent's by the triangle (Pump beats Leverage, Leverage beats Hedge, Hedge beats Pump) your Momentum +1 (max 3); if you were out-read it resets to 0; same kind leaves it unchanged. Strike damage gets +10% per Momentum level (applied after mood). The UI shows `MOMENTUM ▮▮▯ +20%` on the plate and reveals both sealed picks before a turn resolves.
Per-BrokerMon move numbers now differ (see `rules/roster.json`); balance report: all 8 between 44.9% and 56.6% overall, average 5.33 turns (`cargo run -p duel-rules --example balance --release`).
