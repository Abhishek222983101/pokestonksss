use crate::{resolve_turn, MatchState, MAX_TURNS, NO_WINNER, RND_USED};

pub const TURN_LOG_BYTES: usize = 2 + RND_USED + 2;

/// One logged turn: what the chain stores (`picks`, `rnd[0..10]`, `mood`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct TurnLog {
    pub picks: [u8; 2],
    pub rnd: [u8; RND_USED],
    pub mood: [i8; 2],
}

impl TurnLog {
    /// Layout: picks[2] | rnd[10] | mood[2] (as i8 bytes).
    pub fn from_bytes(b: &[u8; TURN_LOG_BYTES]) -> TurnLog {
        let mut rnd = [0u8; RND_USED];
        rnd.copy_from_slice(&b[2..2 + RND_USED]);
        TurnLog { picks: [b[0], b[1]], rnd, mood: [b[2 + RND_USED] as i8, b[3 + RND_USED] as i8] }
    }
    pub fn to_bytes(&self) -> [u8; TURN_LOG_BYTES] {
        let mut o = [0u8; TURN_LOG_BYTES];
        o[0] = self.picks[0];
        o[1] = self.picks[1];
        o[2..2 + RND_USED].copy_from_slice(&self.rnd);
        o[2 + RND_USED] = self.mood[0] as u8;
        o[3 + RND_USED] = self.mood[1] as u8;
        o
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Outcome {
    pub winner: u8,
    pub hp: [u16; 2],
    pub turns: u8,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ReplayError {
    BadSpecies,
    /// Pick out of range at this (0-based) turn.
    BadPick(u8),
    /// More than MAX_TURNS entries.
    TooLong,
    /// The log ended before anyone won.
    Unfinished,
    /// Entries remain after the match was decided.
    TrailingTurns,
}

impl ReplayError {
    pub fn code(&self) -> &'static str {
        match self {
            ReplayError::BadSpecies => "bad_species",
            ReplayError::BadPick(_) => "bad_pick",
            ReplayError::TooLong => "too_long",
            ReplayError::Unfinished => "unfinished",
            ReplayError::TrailingTurns => "trailing_turns",
        }
    }
}

/// Re-simulate a full match from the species pair and per-turn log.
pub fn replay(species: [u8; 2], log: &[TurnLog]) -> Result<Outcome, ReplayError> {
    let mut st = MatchState::new(species[0], species[1]).ok_or(ReplayError::BadSpecies)?;
    if log.len() > MAX_TURNS as usize {
        return Err(ReplayError::TooLong);
    }
    for (i, t) in log.iter().enumerate() {
        if st.winner != NO_WINNER {
            return Err(ReplayError::TrailingTurns);
        }
        if t.picks[0] > 3 || t.picks[1] > 3 {
            return Err(ReplayError::BadPick(i as u8));
        }
        let mut rnd = [0u8; 32];
        rnd[..RND_USED].copy_from_slice(&t.rnd);
        resolve_turn(&mut st, t.picks, &rnd, t.mood);
    }
    if st.winner == NO_WINNER {
        return Err(ReplayError::Unfinished);
    }
    Ok(Outcome { winner: st.winner, hp: [st.f[0].hp, st.f[1].hp], turns: st.turn })
}
