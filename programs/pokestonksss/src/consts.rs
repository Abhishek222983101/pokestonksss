use anchor_lang::prelude::*;

pub const TRAINER_SEED: &[u8] = b"trainer";
pub const ARENA_SEED: &[u8] = b"arena";

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
