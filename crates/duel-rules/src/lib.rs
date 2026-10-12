//! Deterministic duel rules. `#![no_std]`, no dependencies, no floats, no allocation.
//! Source of truth: `docs/RULES.md` (+ its Clarifications section).
#![no_std]
#![forbid(unsafe_code)]

mod bot;
mod elo;
mod fmt;
mod replay;
mod roster_data;

pub use bot::{bot_pick, Tier};
pub use elo::elo_update;
pub use replay::{replay, Outcome, ReplayError, TurnLog, TURN_LOG_BYTES};
pub use roster_data::{NAMES, ROSTER, ROSTER_LEN};

pub const MAX_TURNS: u8 = 16;
pub const NUM_TYPES: u8 = 5;
/// Winner value while the match is still running.
pub const NO_WINNER: u8 = 255;
/// Number of random bytes `resolve_turn`/`bot_pick` read (`rnd[0..10]`). Only these are ever stored on-chain.
pub const RND_USED: usize = 10;
pub const STATE_BYTES: usize = 16;

pub const SLOT_SIGNATURE: u8 = 0;
pub const SLOT_COVERAGE: u8 = 1;
pub const SLOT_GUARD: u8 = 2;
pub const SLOT_CHARGE: u8 = 3;

/// A move slot choice, 0..=3.
pub type Pick = u8;
/// Market mood for a side's attacks: +1 bull, 0 flat, -1 bear (values are clamped by sign).
pub type Mood = i8;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MoveKind {
    Strike,
    Guard,
    Charge,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Move {
    pub kind: MoveKind,
    pub typ: u8,
    pub power: u8,
    pub acc: u8,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Species {
    pub id: u8,
    pub typ: u8,
    pub hp: u16,
    pub atk: u16,
    pub def: u16,
    pub spd: u16,
    /// Pyth Lazer / oracle feed id of the BrokerMon's asset.
    pub feed: u16,
    pub moves: [Move; 4],
}

/// Looks a species up; `None` when out of range.
pub fn species(id: u8) -> Option<&'static Species> {
    ROSTER.get(id as usize)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Fighter {
    pub species: u8,
    pub hp: u16,
    pub max_hp: u16,
    /// Leverage armed: the next STRIKE (hit or miss) consumes it for x2.
    pub charged: bool,
    /// Picked GUARD on the previous turn.
    pub last_guard: bool,
    /// Momentum level 0..=3: +10% strike damage per level; built by out-reading the opponent (see `resolve_turn`).
    pub momentum: u8,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct MatchState {
    pub f: [Fighter; 2],
    pub turn: u8,
    /// `NO_WINNER` while running, else 0 or 1.
    pub winner: u8,
}

impl MatchState {
    /// Fresh match; `None` if a species id is invalid.
    pub fn new(a: u8, b: u8) -> Option<MatchState> {
        Some(MatchState { f: [new_fighter(a)?, new_fighter(b)?], turn: 0, winner: NO_WINNER })
    }
    pub fn is_over(&self) -> bool {
        self.winner != NO_WINNER
    }
    pub fn to_bytes(&self) -> [u8; STATE_BYTES] {
        let mut o = [0u8; STATE_BYTES];
        o[0] = self.turn;
        o[1] = self.winner;
        for (i, f) in self.f.iter().enumerate() {
            let b = 2 + i * 7;
            o[b] = f.species;
            o[b + 1..b + 3].copy_from_slice(&f.hp.to_le_bytes());
            o[b + 3..b + 5].copy_from_slice(&f.max_hp.to_le_bytes());
            o[b + 5] = f.charged as u8;
            o[b + 6] = (f.last_guard as u8) | (f.momentum.min(3) << 1);
        }
        o
    }
    /// Strict decode: validates species, hp <= max_hp, flags 0/1, winner.
    pub fn from_bytes(b: &[u8; STATE_BYTES]) -> Option<MatchState> {
        let mut fs = [new_fighter(0)?; 2];
        for (i, f) in fs.iter_mut().enumerate() {
            let o = 2 + i * 7;
            species(b[o])?;
            let hp = u16::from_le_bytes([b[o + 1], b[o + 2]]);
            let max_hp = u16::from_le_bytes([b[o + 3], b[o + 4]]);
            if hp > max_hp || b[o + 5] > 1 || b[o + 6] > 7 {
                return None;
            }
            *f = Fighter { species: b[o], hp, max_hp, charged: b[o + 5] == 1, last_guard: b[o + 6] & 1 == 1, momentum: (b[o + 6] >> 1) & 3 };
        }
        if b[1] != NO_WINNER && b[1] > 1 {
            return None;
        }
        Some(MatchState { f: fs, turn: b[0], winner: b[1] })
    }
}

pub fn new_fighter(species_id: u8) -> Option<Fighter> {
    let s = species(species_id)?;
    Some(Fighter { species: species_id, hp: s.hp, max_hp: s.hp, charged: false, last_guard: false, momentum: 0 })
}

/// Type effectiveness in percent: 200 super, 100 neutral, 50 resisted.
pub fn eff(att: u8, def: u8) -> u32 {
    let d = (def % NUM_TYPES + NUM_TYPES - att % NUM_TYPES) % NUM_TYPES;
    match d {
        0 => 100,
        1 | 2 => 200,
        _ => 50,
    }
}

/// All inputs of the damage pipeline (percent values; floor after each step).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct DamageIn {
    pub power: u32,
    pub atk: u32,
    pub def: u32,
    pub stab: bool,
    pub eff: u32,
    /// 85..=100
    pub variance: u32,
    pub crit: bool,
    pub mood: Mood,
    pub charged: bool,
    /// 100 normal, 20 target guarded, 50 target guarded again.
    pub guard_pct: u32,
    pub vulnerable: bool,
    /// Attacker's momentum level 0..=3.
    pub momentum: u32,
}

pub fn mood_pct(m: Mood) -> u32 {
    if m > 0 {
        110
    } else if m < 0 {
        90
    } else {
        100
    }
}

/// The RULES.md damage pipeline, integer, floor after each step, min 1.
pub fn damage(i: &DamageIn) -> u32 {
    let mut d = (22 * i.power * i.atk / i.def.max(1)) / 50 + 2;
    d = d * if i.stab { 125 } else { 100 } / 100;
    d = d * i.eff / 100;
    d = d * i.variance / 100;
    d = d * if i.crit { 150 } else { 100 } / 100;
    d = d * mood_pct(i.mood) / 100;
    d = d * if i.charged { 200 } else { 100 } / 100;
    d = d * i.guard_pct / 100;
    d = d * if i.vulnerable { 130 } else { 100 } / 100;
    d = d * (100 + 10 * i.momentum.min(3)) / 100;
    d.max(1)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Event {
    /// Attacker's market mood this turn (only emitted when non-zero).
    Mood { side: u8, mood: i8 },
    Guard { side: u8, heal: u16 },
    Charge { side: u8 },
    Miss { side: u8 },
    /// `side` is the attacker; `eff` is 50/100/200.
    Hit { side: u8, dmg: u16, crit: bool, eff: u16 },
    /// `side` is the fighter that was liquidated.
    Ko { side: u8 },
    /// Match ended this turn. `by_ko` false means decided at MAX_TURNS.
    End { winner: u8, by_ko: bool },
}

pub const MAX_EVENTS: usize = 12;

/// Fixed-capacity event buffer (worst case per turn is 10).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Events {
    buf: [Event; MAX_EVENTS],
    len: u8,
}

impl Events {
    pub const fn new() -> Self {
        Events { buf: [Event::Charge { side: 0 }; MAX_EVENTS], len: 0 }
    }
    fn push(&mut self, e: Event) {
        if (self.len as usize) < MAX_EVENTS {
            self.buf[self.len as usize] = e;
            self.len += 1;
        }
    }
    pub fn as_slice(&self) -> &[Event] {
        &self.buf[..self.len as usize]
    }
    pub fn len(&self) -> usize {
        self.len as usize
    }
    pub fn is_empty(&self) -> bool {
        self.len == 0
    }
    pub fn iter(&self) -> core::slice::Iter<'_, Event> {
        self.as_slice().iter()
    }
}

impl Default for Events {
    fn default() -> Self {
        Events::new()
    }
}

/// The triangle: Strike beats Charge, Charge beats Guard, Guard beats Strike.
pub fn beats(a: MoveKind, b: MoveKind) -> bool {
    matches!((a, b), (MoveKind::Strike, MoveKind::Charge) | (MoveKind::Charge, MoveKind::Guard) | (MoveKind::Guard, MoveKind::Strike))
}

fn kind_of(s: &Species, pick: u8) -> MoveKind {
    s.moves[pick as usize].kind
}

/// Resolve one turn in place. Reads only `rnd[0..10]`:
/// `[0]`/`[1]` accuracy s0/s1, `[2]`/`[3]` crit, `[4]`/`[5]` variance, `[6]` speed tie, `[7]` final tie-break,
/// `[8]`/`[9]` bot. `mood[i]` applies to side i's attacks. Invalid input (pick > 3, bad species, finished match)
/// returns an empty event list and leaves `st` untouched.
pub fn resolve_turn(st: &mut MatchState, picks: [u8; 2], rnd: &[u8; 32], mood: [i8; 2]) -> Events {
    let mut ev = Events::new();
    if st.is_over() || picks[0] > 3 || picks[1] > 3 {
        return ev;
    }
    let sp = match (species(st.f[0].species), species(st.f[1].species)) {
        (Some(a), Some(b)) => [a, b],
        _ => return ev,
    };
    let kinds = [kind_of(sp[0], picks[0]), kind_of(sp[1], picks[1])];
    let prev_guard = [st.f[0].last_guard, st.f[1].last_guard];

    for s in 0..2 {
        if mood[s] != 0 {
            ev.push(Event::Mood { side: s as u8, mood: mood[s].signum() });
        }
    }
    // 1. guard heals, charge flags
    for s in 0..2 {
        match kinds[s] {
            MoveKind::Guard => {
                let heal = if prev_guard[s] { 0 } else { st.f[s].max_hp / 10 };
                let f = &mut st.f[s];
                let new_hp = (f.hp as u32 + heal as u32).min(f.max_hp as u32) as u16;
                let healed = new_hp - f.hp;
                f.hp = new_hp;
                ev.push(Event::Guard { side: s as u8, heal: healed });
            }
            MoveKind::Charge => {
                st.f[s].charged = true;
                ev.push(Event::Charge { side: s as u8 });
            }
            MoveKind::Strike => {}
        }
    }
    // 2. strikes in speed order
    let first = if sp[0].spd > sp[1].spd {
        0
    } else if sp[1].spd > sp[0].spd {
        1
    } else {
        (rnd[6] & 1) as usize
    };
    let mut ko = false;
    for &a in &[first, 1 - first] {
        if kinds[a] != MoveKind::Strike {
            continue;
        }
        let d = 1 - a;
        let mv = sp[a].moves[picks[a] as usize];
        let was_charged = st.f[a].charged;
        st.f[a].charged = false;
        if (rnd[a] % 100) as u32 >= mv.acc as u32 {
            ev.push(Event::Miss { side: a as u8 });
            continue;
        }
        let e = eff(mv.typ, sp[d].typ);
        let crit = rnd[2 + a] < 16;
        let guard_pct = if kinds[d] == MoveKind::Guard {
            if prev_guard[d] {
                50
            } else {
                20
            }
        } else {
            100
        };
        let dmg = damage(&DamageIn {
            power: mv.power as u32,
            atk: sp[a].atk as u32,
            def: sp[d].def as u32,
            stab: mv.typ == sp[a].typ,
            eff: e,
            variance: 85 + (rnd[4 + a] % 16) as u32,
            crit,
            mood: mood[a],
            charged: was_charged,
            guard_pct,
            vulnerable: kinds[d] == MoveKind::Charge,
            momentum: st.f[a].momentum as u32,
        });
        let dmg = dmg.min(st.f[d].hp as u32) as u16;
        // Reported damage is the HP actually removed (overkill is clipped).
        st.f[d].hp -= dmg;
        ev.push(Event::Hit { side: a as u8, dmg, crit, eff: e as u16 });
        if st.f[d].hp == 0 {
            ev.push(Event::Ko { side: d as u8 });
            st.winner = a as u8;
            ko = true;
            break;
        }
    }
    // 3. bookkeeping
    // Momentum: out-reading the opponent (Pump > Leverage > Hedge > Pump) builds it; being out-read resets it.
    for s in 0..2usize {
        let (mine, theirs) = (kinds[s], kinds[1 - s]);
        if beats(mine, theirs) {
            st.f[s].momentum = (st.f[s].momentum + 1).min(3);
        } else if beats(theirs, mine) {
            st.f[s].momentum = 0;
        }
    }
    st.f[0].last_guard = kinds[0] == MoveKind::Guard;
    st.f[1].last_guard = kinds[1] == MoveKind::Guard;
    st.turn += 1;
    if ko {
        ev.push(Event::End { winner: st.winner, by_ko: true });
    } else if st.turn >= MAX_TURNS {
        let r0 = st.f[0].hp as u32 * 1000 / st.f[0].max_hp.max(1) as u32;
        let r1 = st.f[1].hp as u32 * 1000 / st.f[1].max_hp.max(1) as u32;
        st.winner = if r0 > r1 {
            0
        } else if r1 > r0 {
            1
        } else {
            rnd[7] & 1
        };
        ev.push(Event::End { winner: st.winner, by_ko: false });
    }
    ev
}

/// Damage preview for UI: `(min, max, eff, acc)` of `side` using `slot` on the opponent, assuming the opponent
/// neither guards nor charges. min = variance 85, no crit; max = variance 100 with crit. Includes the attacker's
/// Leverage and `mood`. Returns `None` for non-strike slots / invalid input.
pub fn preview_damage(st: &MatchState, side: u8, slot: u8, mood: Mood) -> Option<(u32, u32, u32, u32)> {
    if side > 1 || slot > 3 {
        return None;
    }
    let a = species(st.f[side as usize].species)?;
    let d = species(st.f[1 - side as usize].species)?;
    let mv = a.moves[slot as usize];
    if mv.kind != MoveKind::Strike {
        return None;
    }
    let mut i = DamageIn {
        power: mv.power as u32,
        atk: a.atk as u32,
        def: d.def as u32,
        stab: mv.typ == a.typ,
        eff: eff(mv.typ, d.typ),
        variance: 85,
        crit: false,
        mood,
        charged: st.f[side as usize].charged,
        guard_pct: 100,
        vulnerable: false,
        momentum: st.f[side as usize].momentum as u32,
    };
    let min = damage(&i);
    i.variance = 100;
    i.crit = true;
    Some((min, damage(&i), i.eff, mv.acc as u32))
}

#[cfg(test)]
mod tests;
