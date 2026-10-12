use crate::{damage, eff, lvl_stat, species, DamageIn, MatchState, MoveKind, MAX_LEVEL, RND_USED};

/// House Agent difficulty = exploration noise.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Tier {
    /// ~75% random.
    Rookie,
    /// 25% random.
    Pro,
    /// ~10% random.
    Champion,
    /// Beginner opponent: always random, and passive (leans on Hedge/Leverage, which Pump punishes).
    Trainee,
    /// Judge demo dummy: only ever Hedges (never attacks), so any attack line wins.
    Dummy,
}

impl Tier {
    /// `rnd[8] < threshold` => random pick from `rnd[9] % 4`.
    pub const fn threshold(self) -> u8 {
        match self {
            Tier::Rookie => 190,
            Tier::Pro => 64,
            Tier::Champion => 26,
            Tier::Trainee => 255,
            Tier::Dummy => 255,
        }
    }
    pub fn from_u8(v: u8) -> Option<Tier> {
        match v {
            0 => Some(Tier::Rookie),
            1 => Some(Tier::Pro),
            2 => Some(Tier::Champion),
            3 => Some(Tier::Trainee),
            4 => Some(Tier::Dummy),
            _ => None,
        }
    }
}

// Heuristic scores are in "accuracy% x expected damage" units.
const GUARD_LOW_HP: u32 = 1500;
const GUARD_VS_CHARGED: u32 = 3000;
const CHARGE_BASE: u32 = 600;
const CHARGE_VS_GUARDER: u32 = 4500;

/// House Agent pick for `side`. By signature it receives no pending pick of the other side: it sees only the
/// match state (its own fighter and the opponent's public hp/species/flags) and the randomness bytes.
/// Returns 0 for invalid input (bad side/species), so the result is always a valid slot.
pub fn bot_pick(st: &MatchState, side: u8, rnd: &[u8; 32], tier: Tier) -> u8 {
    let _ = RND_USED;
    if side > 1 {
        return 0;
    }
    if tier == Tier::Dummy {
        return 3;
    }
    if tier == Tier::Trainee {
        // 1/8 Signature, 1/8 Coverage, 3/8 Hedge, 3/8 Leverage: easy to read and to punish with Pump.
        return match rnd[9] % 8 {
            0 => 0,
            1 => 1,
            2..=4 => 2,
            _ => 3,
        };
    }
    if rnd[8] < tier.threshold() {
        return rnd[9] % 4;
    }
    let me = &st.f[side as usize];
    let opp = &st.f[1 - side as usize];
    let (ms, os) = match (species(me.species), species(opp.species)) {
        (Some(a), Some(b)) => (a, b),
        _ => return 0,
    };
    let my_pct = me.hp as u32 * 100 / me.max_hp.max(1) as u32;
    let mut best = 0u8;
    let mut best_score = 0u32;
    let mut first = true;
    for slot in 0..4u8 {
        let mv = ms.moves[slot as usize];
        let score = match mv.kind {
            MoveKind::Strike => {
                let d = damage(&DamageIn {
                    power: mv.power as u32,
                    atk: lvl_stat(ms.atk, me.level),
                    def: lvl_stat(os.def, opp.level),
                    stab: mv.typ == ms.typ,
                    eff: eff(mv.typ, os.typ),
                    variance: 100,
                    crit: false,
                    mood: 0,
                    charged: me.charged,
                    guard_pct: 100,
                    vulnerable: false,
                    momentum: me.momentum as u32,
                });
                d.min(opp.hp as u32) * mv.acc as u32
            }
            MoveKind::Guard => {
                let mut s = 0;
                if !me.last_guard {
                    if my_pct < 40 {
                        s += GUARD_LOW_HP;
                    }
                    if opp.charged {
                        s += GUARD_VS_CHARGED;
                    }
                }
                s
            }
            MoveKind::Charge => {
                if me.charged {
                    0
                } else {
                    let mut s = CHARGE_BASE;
                    if my_pct > 60 && opp.last_guard {
                        s += CHARGE_VS_GUARDER;
                    }
                    s
                }
            }
        };
        if first || score > best_score {
            best = slot;
            best_score = score;
            first = false;
        }
    }
    best
}

/// Level of the House Agent's creature: shadows the player's level so the ladder stays fair as you grow.
/// Trainee and the judge Dummy stay at level 0.
pub fn bot_level(tier: Tier, player_level: u8) -> u8 {
    match tier {
        Tier::Trainee | Tier::Dummy => 0,
        Tier::Rookie => player_level.saturating_sub(1),
        Tier::Pro => player_level,
        Tier::Champion => (player_level + 1).min(MAX_LEVEL),
    }
}
