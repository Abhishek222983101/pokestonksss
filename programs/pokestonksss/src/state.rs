use crate::consts::*;
use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct Trainer {
    pub owner: Pubkey,
    pub rating: u16,
    pub wins: u16,
    pub losses: u16,
    pub streak: u8,
    /// BrokerDex bitmask: bit i set = defeated species i at least once.
    pub dex: u16,
    pub battles: u32,
    /// Battles since the last commit to Solana.
    pub unsaved: u8,
    pub commits: u8,
    pub name_seed: u32,
    /// XP per species (index = species id); level = `duel_rules::level_for_xp`.
    pub xp: [u16; 8],
    /// Trainer avatar choice 0..=5.
    pub avatar: u8,
    pub bump: u8,
}

/// Marker that a badge was minted to an owner (makes `mint_badge` idempotent per owner and badge).
#[account]
#[derive(InitSpace)]
pub struct Claim {
    pub owner: Pubkey,
    pub id: u8,
    pub slot: u64,
}

#[account]
#[derive(InitSpace)]
pub struct Arena {
    pub host: Pubkey,
    /// Guest trainer owner (duel) or default (practice vs House Agent).
    pub guest: Pubkey,
    pub mode: u8,
    pub phase: u8,
    pub tier: u8,
    /// duel_rules::MatchState bytes.
    pub state: [u8; duel_rules::STATE_BYTES],
    /// Pending picks per side (NO_PICK = none). In duels these hold *revealed* picks only.
    pub picks: [u8; 2],
    /// Duel sealing: sha256 commitments per side and which sides committed / revealed (bit0 host, bit1 guest).
    pub commits: [[u8; 32]; 2],
    pub committed_mask: u8,
    pub revealed_mask: u8,
    pub vrf_pending: bool,
    pub rnd_turn: u8,
    pub token_hash: [u8; 32],
    pub opened_at: i64,
    pub updated_at: i64,
    pub deadline: i64,
    pub timeouts: [u8; 2],
    /// Oracle snapshot at the bell (price, 0 = unavailable).
    pub snap: [i64; 2],
    pub winner: u8,
    pub log_len: u8,
    pub log: [[u8; LOG_ENTRY]; LOG_SLOTS],
    pub bump: u8,
}

impl Arena {
    pub fn seat_of(&self, who: &Pubkey) -> Option<usize> {
        if *who == self.host {
            Some(0)
        } else if self.mode == MODE_DUEL && *who == self.guest {
            Some(1)
        } else {
            None
        }
    }
}

const _: () = assert!(8 + Arena::INIT_SPACE <= 800);
const _: () = assert!(8 + Trainer::INIT_SPACE == 8 + 69);
