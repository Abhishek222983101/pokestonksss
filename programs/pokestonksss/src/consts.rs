use anchor_lang::prelude::*;

/// Season 2 account layout (levels, xp, avatar, session keys): new seeds so every player starts clean.
pub const TRAINER_SEED: &[u8] = b"trainer2";
pub const ARENA_SEED: &[u8] = b"arena2";
pub const BADGE_MINT_SEED: &[u8] = b"badge_mint";
pub const BADGE_AUTH_SEED: &[u8] = b"badge_auth";
pub const CLAIM_SEED: &[u8] = b"claim";
/// Seed the validator's task scheduler uses for the per-task signer PDA.
pub const CRANK_SEED: &[u8] = b"crank-executor";
/// Number of badge types (see `badge_earned`): 0..=7 milestones, 8..=15 one trophy per defeated BrokerMon.
pub const BADGES: u8 = 16;
/// A duel untouched this long is settled by the crank (the idle side forfeits).
pub const ABANDON_SECS: i64 = 60;
pub const CRANK_INTERVAL_MS: i64 = 20_000;
pub const CRANK_ITERATIONS: i64 = 8;

/// MagicBlock real-time pricing oracle (devnet + mainnet, same address).
pub const ORACLE_PROGRAM_ID: Pubkey = pubkey!("PriCems5tHihc6UDXDjzjeawomAwBduWMGAi8ZUjppd");
pub const ORACLE_MAX_AGE_SECS: i64 = 10;
/// Price move (in basis points of the snapshot) below which mood stays flat.
pub const MOOD_DEADBAND_BPS: i128 = 1;

pub const TURN_TIMEOUT_SECS: i64 = 30;
pub const DUEL_JOIN_WINDOW_SECS: i64 = 600;
/// A live arena untouched this long may be reset by its host (never leaves a player stuck).
pub const STUCK_RESET_SECS: i64 = 90;

pub const MAX_SPECIES: u8 = 8;
pub const NO_PICK: u8 = 255;
pub const START_RATING: u16 = 1000;
/// Practice opponents' Elo by House Agent tier (Rookie, Pro, Champion, Trainee).
pub const BOT_RATING: [i32; 5] = [800, 1000, 1200, 700, 600];

// Arena phases
pub const PHASE_IDLE: u8 = 0;
pub const PHASE_WAITING: u8 = 1;
pub const PHASE_PICKING: u8 = 2;
pub const PHASE_REVEALING: u8 = 3;
pub const PHASE_ROLLING: u8 = 4;
pub const PHASE_FINISHED: u8 = 5;

pub const MODE_PRACTICE: u8 = 0;
pub const MODE_DUEL: u8 = 1;

pub const LOG_SLOTS: usize = 16;
pub const LOG_ENTRY: usize = duel_rules::TURN_LOG_BYTES;
