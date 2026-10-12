//! JSON rendering shared by the WASM bindings and the fixture generator (one definition of the wire shape).
//! Only linked when used; the on-chain program never references it.
use crate::{Event, Events, MatchState};
use core::fmt::{self, Display, Formatter};

impl Display for Event {
    fn fmt(&self, f: &mut Formatter<'_>) -> fmt::Result {
        match *self {
            Event::Mood { side, mood } => write!(f, "{{\"t\":\"mood\",\"side\":{},\"mood\":{}}}", side, mood),
            Event::Guard { side, heal } => write!(f, "{{\"t\":\"guard\",\"side\":{},\"heal\":{}}}", side, heal),
            Event::Charge { side } => write!(f, "{{\"t\":\"charge\",\"side\":{}}}", side),
            Event::Miss { side } => write!(f, "{{\"t\":\"miss\",\"side\":{}}}", side),
            Event::Hit { side, dmg, crit, eff } => {
                write!(f, "{{\"t\":\"hit\",\"side\":{},\"dmg\":{},\"crit\":{},\"eff\":{}}}", side, dmg, crit, eff)
            }
            Event::Ko { side } => write!(f, "{{\"t\":\"ko\",\"side\":{}}}", side),
            Event::End { winner, by_ko } => write!(f, "{{\"t\":\"end\",\"winner\":{},\"byKo\":{}}}", winner, by_ko),
        }
    }
}

impl Display for Events {
    fn fmt(&self, f: &mut Formatter<'_>) -> fmt::Result {
        f.write_str("[")?;
        for (i, e) in self.iter().enumerate() {
            if i > 0 {
                f.write_str(",")?;
            }
            write!(f, "{}", e)?;
        }
        f.write_str("]")
    }
}

impl Display for MatchState {
    fn fmt(&self, f: &mut Formatter<'_>) -> fmt::Result {
        write!(f, "{{\"turn\":{},\"winner\":", self.turn)?;
        if self.is_over() {
            write!(f, "{}", self.winner)?;
        } else {
            f.write_str("null")?;
        }
        f.write_str(",\"f\":[")?;
        for (i, x) in self.f.iter().enumerate() {
            if i > 0 {
                f.write_str(",")?;
            }
            write!(
                f,
                "{{\"species\":{},\"hp\":{},\"maxHp\":{},\"charged\":{},\"lastGuard\":{},\"momentum\":{},\"level\":{}}}",
                x.species, x.hp, x.max_hp, x.charged, x.last_guard, x.momentum, x.level
            )?;
        }
        f.write_str("]}")
    }
}
