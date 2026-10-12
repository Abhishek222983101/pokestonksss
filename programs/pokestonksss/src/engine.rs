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
            let bot = BOT_RATING[(a.tier as usize).min(3)];
            bump(host, winner == 0, bot, st.f[1].species);
        }
        Some(g) => {
            let (hr, gr) = (host.rating as i32, g.rating as i32);
            bump(host, winner == 0, gr, st.f[1].species);
            bump(g, winner == 1, hr, st.f[0].species);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn trainer(rating: u16) -> Trainer {
        Trainer { owner: Pubkey::new_unique(), rating, wins: 0, losses: 0, streak: 0, dex: 0, battles: 0, unsaved: 0, commits: 0, name_seed: 1, bump: 255 }
    }
    fn arena(mode: u8, winner: u8) -> Arena {
        Arena {
            host: Pubkey::new_unique(), guest: Pubkey::new_unique(), mode, phase: PHASE_FINISHED, tier: 1,
            state: [0; duel_rules::STATE_BYTES], picks: [NO_PICK; 2], commits: [[0; 32]; 2], committed_mask: 0, revealed_mask: 0,
            vrf_pending: false, rnd_turn: 0, token_hash: [0; 32], opened_at: 0, updated_at: 0, deadline: 0, timeouts: [0; 2],
            snap: [0; 2], winner, log_len: 0, log: [[0; LOG_ENTRY]; LOG_SLOTS], bump: 255,
        }
    }

    #[test]
    fn practice_win_updates_host_only_and_sets_dex() {
        let a = arena(MODE_PRACTICE, 0);
        let st = MatchState::new(0, 3).unwrap();
        let mut h = trainer(1000);
        settle(&a, &st, &mut h, None);
        assert_eq!((h.wins, h.losses, h.streak, h.battles, h.unsaved), (1, 0, 1, 1, 1));
        assert!(h.rating > 1000);
        assert_eq!(h.dex, 1 << 3);
    }

    #[test]
    fn practice_loss_resets_streak() {
        let a = arena(MODE_PRACTICE, 1);
        let st = MatchState::new(0, 3).unwrap();
        let mut h = trainer(1000);
        h.streak = 4;
        settle(&a, &st, &mut h, None);
        assert_eq!((h.wins, h.losses, h.streak), (0, 1, 0));
        assert!(h.rating < 1000);
        assert_eq!(h.dex, 0);
    }

    #[test]
    fn duel_is_zero_sum_and_updates_both() {
        let a = arena(MODE_DUEL, 1);
        let st = MatchState::new(2, 5).unwrap();
        let (mut h, mut g) = (trainer(1000), trainer(1000));
        settle(&a, &st, &mut h, Some(&mut g));
        assert_eq!(h.rating as i32 + g.rating as i32, 2000);
        assert_eq!((h.losses, g.wins), (1, 1));
        assert_eq!(g.dex, 1 << 2);
    }

    #[test]
    fn commitment_binds_every_field() {
        let (arena, who) = (Pubkey::new_unique(), Pubkey::new_unique());
        let salt = [7u8; 32];
        let base = commitment(1, &salt, &arena, 3, &who);
        assert_ne!(base, commitment(2, &salt, &arena, 3, &who));
        assert_ne!(base, commitment(1, &[8u8; 32], &arena, 3, &who));
        assert_ne!(base, commitment(1, &salt, &Pubkey::new_unique(), 3, &who));
        assert_ne!(base, commitment(1, &salt, &arena, 4, &who));
        assert_ne!(base, commitment(1, &salt, &arena, 3, &Pubkey::new_unique()));
        assert_eq!(base, commitment(1, &salt, &arena, 3, &who));
    }

    #[test]
    fn commitment_known_answer_matches_sdk() {
        let h = commitment(1, &[7u8; 32], &Pubkey::new_from_array([1u8; 32]), 3, &Pubkey::new_from_array([2u8; 32]));
        let hex: String = h.iter().map(|b| format!("{:02x}", b)).collect();
        assert_eq!(hex, "ef7f7f129e62d7d4d84eeb28ea89ad29b136d82605edbd9584b5ce521dc186c0");
    }

    #[test]
    fn log_is_capped_and_replayable() {
        let mut a = arena(MODE_PRACTICE, NO_WINNER);
        for i in 0..20u8 {
            push_log(&mut a, [i % 4, 2], &[i; 32], [0, 1]);
        }
        assert_eq!(a.log_len as usize, LOG_SLOTS);
        assert_eq!(TurnLog::from_bytes(&a.log[0]).picks, [0, 2]);
    }

    #[test]
    fn seat_lookup_and_sizes() {
        let a = arena(MODE_DUEL, NO_WINNER);
        assert_eq!(a.seat_of(&a.host), Some(0));
        assert_eq!(a.seat_of(&a.guest), Some(1));
        assert_eq!(a.seat_of(&Pubkey::new_unique()), None);
        assert!(8 + Arena::INIT_SPACE <= 800, "arena {} B", 8 + Arena::INIT_SPACE);
        assert!(8 + Trainer::INIT_SPACE <= 128);
    }
}
