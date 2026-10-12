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
