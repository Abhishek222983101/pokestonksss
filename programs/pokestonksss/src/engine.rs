//! Battle bookkeeping shared by the instructions: logging, settlement, hashing.
use crate::consts::*;
use crate::state::*;
use anchor_lang::prelude::*;
use duel_rules::{elo_update, MatchState, TurnLog, NO_WINNER};

pub fn load_state(a: &Arena) -> Result<MatchState> {
    MatchState::from_bytes(&a.state).ok_or_else(|| error!(crate::errors::GameError::CorruptState))
}

pub fn push_log(a: &mut Arena, picks: [u8; 2], rnd: &[u8; 32], mood: [i8; 2]) {
    if (a.log_len as usize) < LOG_SLOTS {
        let mut r = [0u8; duel_rules::RND_USED];
        r.copy_from_slice(&rnd[..duel_rules::RND_USED]);
        a.log[a.log_len as usize] = TurnLog { picks, rnd: r, mood }.to_bytes();
        a.log_len += 1;
    }
}

/// Commitment hash for a sealed pick (duel).
pub fn commitment(slot: u8, salt: &[u8; 32], arena: &Pubkey, turn: u8, player: &Pubkey) -> [u8; 32] {
    solana_sha256_hasher::hashv(&[&[slot], salt, arena.as_ref(), &[turn], player.as_ref()]).to_bytes()
}

pub fn token_hash(token: &[u8; 32]) -> [u8; 32] {
    solana_sha256_hasher::hashv(&[token]).to_bytes()
}

/// Updates trainer records after a finished match. `guest` is None for practice.
pub fn settle(a: &Arena, st: &MatchState, host: &mut Trainer, guest: Option<&mut Trainer>) {
    let winner = a.winner;
    if winner == NO_WINNER {
        return;
    }
    let bump = |t: &mut Trainer, won: bool, opp_rating: i32, opp_species: u8| {
        let r = t.rating as i32;
        let new_r = if won { elo_update(r, opp_rating).0 } else { elo_update(opp_rating, r).1 };
        t.rating = new_r.clamp(0, u16::MAX as i32) as u16;
        if won {
            t.wins = t.wins.saturating_add(1);
            t.streak = t.streak.saturating_add(1);
            t.dex |= 1u16 << (opp_species as u16 % 16);
        } else {
            t.losses = t.losses.saturating_add(1);
            t.streak = 0;
        }
        t.battles = t.battles.saturating_add(1);
        t.unsaved = t.unsaved.saturating_add(1);
    };
    match guest {
        None => {
            let bot = BOT_RATING[(a.tier as usize).min(2)];
            bump(host, winner == 0, bot, st.f[1].species);
        }
        Some(g) => {
            let (hr, gr) = (host.rating as i32, g.rating as i32);
            bump(host, winner == 0, gr, st.f[1].species);
            bump(g, winner == 1, hr, st.f[0].species);
        }
    }
}
