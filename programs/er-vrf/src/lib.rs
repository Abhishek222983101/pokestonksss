//! Spike: one Anchor program that exercises every MagicBlock primitive we need
//! for a turn-based PvP battler:
//!
//!   * state PDA `Battle` (exactly 300 bytes on chain)
//!   * `create_battle`  (base layer)              - init account
//!   * `delegate_battle`(base layer)              - delegate, validator in remaining_accounts[0]
//!   * `play_move`      (ER, session or wallet)   - hot-path ix, also (re)arms the turn timer crank
//!   * `request_roll`   (ER, session or wallet)   - delegated VRF request (ER queue)
//!   * `callback_roll`  (ER, VRF oracle only)     - VRF callback writes a random byte into state
//!   * `timeout_turn`   (ER, crank only)          - fired by the validator's task scheduler
//!   * `cancel_timer`   (ER, session or wallet)   - CancelTask CPI
//!   * `commit_battle`  (ER, session or wallet)   - commit (stay delegated)
//!   * `end_battle`     (ER, session or wallet)   - commit_and_undelegate via MagicIntentBundleBuilder
//!   * `#[ephemeral]`   injects `process_undelegation` (the DLP calls it back on undelegate)
//!
//! Patterns are copied from magicblock-engine-examples:
//!   roll-dice/anchor/programs/roll-dice-delegated  (VRF)
//!   session-keys/anchor/programs/anchor-counter-session (session_auth_or)
//!   crank-counter/anchor/programs/crank-counter  (ScheduleTask; docs/tools/crank/implementation.md)
//!   counter/anchor (delegate / commit / undelegate)

use anchor_lang::prelude::*;
use anchor_lang::solana_program::{
    instruction::{AccountMeta, Instruction},
    program::invoke_signed,
};
use ephemeral_rollups_sdk::anchor::{commit, delegate, ephemeral, vrf, vrf_callback};
use ephemeral_rollups_sdk::consts::MAGIC_PROGRAM_ID;
use ephemeral_rollups_sdk::cpi::DelegateConfig;
use ephemeral_rollups_sdk::ephem::MagicIntentBundleBuilder;
use ephemeral_rollups_sdk::vrf::{
    self,
    instructions::{create_request_scoped_randomness_ix, RequestRandomnessParams},
    types::SerializableAccountMeta,
};
use magicblock_magic_program_api::{
    args::ScheduleTaskArgs, instruction::MagicBlockInstruction, CRANK_PROGRAM_ID,
};
use session_keys::{session_auth_or, Session, SessionError, SessionTokenV2};

declare_id!("DAEhW8UFWVTApkKoLqwkBkQoN2JTSSdJqz1n7y8UWMKX");

pub const BATTLE_SEED: &[u8] = b"battle";
/// Seed used by the validator for the per-authority crank signer PDA
/// (magicblock-magic-program-api/src/pda.rs @ validator v1.0.0).
pub const CRANK_SEED: &[u8] = b"crank-executor";
pub const TURN_TIMEOUT_MS: i64 = 30_000;

#[ephemeral]
#[program]
pub mod er_vrf {
    use super::*;

    // ------------------------------------------------------------------ base layer

    /// Base layer. Creates the 300-byte state PDA.
    pub fn create_battle(ctx: Context<CreateBattle>, opponent: Pubkey) -> Result<()> {
        let b = &mut ctx.accounts.battle;
        b.players = [ctx.accounts.creator.key(), opponent];
        b.turn = 0;
        b.hp = [100, 100];
        Ok(())
    }

    /// Base layer. Delegates the PDA to the ER validator passed as remaining_accounts[0].
    pub fn delegate_battle(ctx: Context<DelegateBattle>) -> Result<()> {
        ctx.accounts.delegate_pda(
            &ctx.accounts.payer,
            &[BATTLE_SEED, ctx.accounts.payer.key().as_ref()],
            DelegateConfig {
                // Optionally set a specific validator from the first remaining account
                validator: ctx.remaining_accounts.first().map(|acc| acc.key()),
                ..Default::default()
            },
        )?;
        Ok(())
    }

    // ------------------------------------------------------------------ ER (hot path)

    /// ER. The player to move (or their session key) plays a move, the turn advances
    /// and the 30 s turn-timeout crank is re-armed for the next player.
    #[session_auth_or(
        ctx.accounts.battle.mover() == ctx.accounts.signer.key(),
        SessionError::InvalidToken
    )]
    pub fn play_move(ctx: Context<PlayMove>, mv: u8) -> Result<()> {
        let bump = ctx.bumps.battle;
        let b = &mut ctx.accounts.battle;
        let slot = (b.turn as usize) % b.log.len();
        b.log[slot] = mv;
        b.turn = b.turn.checked_add(1).ok_or(ErrorCode::Overflow)?;
        b.roll_pending = false;

        // Re-arm the timeout for the new turn (replaces the previous task, same authority = battle PDA).
        let now = Clock::get()?.unix_timestamp;
        b.timer_armed = true;
        b.timer_turn = b.turn;
        b.timer_deadline = now + TURN_TIMEOUT_MS / 1000;
        b.timer_task_id = task_id_for(&b.key());
        let (task_id, creator) = (b.timer_task_id, b.players[0]);
        schedule_turn_timeout(
            &ctx.accounts.battle.to_account_info(),
            &creator,
            bump,
            task_id,
        )
    }

    /// ER. Requests randomness from the *delegated* (ER) VRF queue.
    #[session_auth_or(
        ctx.accounts.battle.mover() == ctx.accounts.signer.key(),
        SessionError::InvalidToken
    )]
    pub fn request_roll(ctx: Context<RequestRoll>, client_seed: u8) -> Result<()> {
        let b = &mut ctx.accounts.battle;
        require!(!b.roll_pending, ErrorCode::RollAlreadyPending);
        b.roll_pending = true;
        b.roll_turn = b.turn;
        let turn = b.turn;
        let ix = create_request_scoped_randomness_ix(RequestRandomnessParams {
            payer: ctx.accounts.signer.key(),
            oracle_queue: ctx.accounts.oracle_queue.key(),
            callback_program_id: ID,
            callback_discriminator: instruction::CallbackRoll::DISCRIMINATOR.to_vec(),
            caller_seed: [client_seed; 32],
            // accounts the callback needs (battle, writable)
            accounts_metas: Some(vec![SerializableAccountMeta {
                pubkey: ctx.accounts.battle.key(),
                is_signer: false,
                is_writable: true,
            }]),
            // appended after `randomness` in the callback ix data -> `for_turn: u32` (borsh, LE)
            callback_args: Some(turn.to_le_bytes().to_vec()),
            ..Default::default()
        });
        ctx.accounts
            .invoke_signed_vrf(&ctx.accounts.signer.to_account_info(), &ix)?;
        Ok(())
    }

    /// ER. Called by the VRF program (signer = scoped identity PDA, enforced by #[vrf_callback]).
    pub fn callback_roll(
        ctx: Context<CallbackRoll>,
        randomness: [u8; 32],
        for_turn: u32,
    ) -> Result<()> {
        let b = &mut ctx.accounts.battle;
        // bind callback to the live request (idempotent: a duplicate/late callback is ignored)
        if !b.roll_pending || b.roll_turn != for_turn {
            msg!("stale or duplicate VRF callback ignored");
            return Ok(());
        }
        b.last_roll = vrf::rnd::random_u8_with_range(&randomness, 1, 6);
        b.roll_pending = false;
        Ok(())
    }

    // ------------------------------------------------------------------ crank

    /// ER. Scheduled by `play_move` with iterations = 2: execution #1 fires immediately (validator
    /// v1.0.0 inserts new tasks with zero delay) and must be a no-op, execution #2 fires after
    /// `execution_interval_millis` and applies the timeout.
    pub fn timeout_turn(ctx: Context<TimeoutTurn>) -> Result<()> {
        let b = &mut ctx.accounts.battle;
        let now = Clock::get()?.unix_timestamp;
        if !b.timer_armed || b.timer_turn != b.turn || now < b.timer_deadline {
            msg!("timeout_turn: not due / stale -> no-op");
            return Ok(());
        }
        b.timer_armed = false;
        b.timeouts = b.timeouts.saturating_add(1);
        let slot = (b.turn as usize) % b.log.len();
        b.log[slot] = 0xFF; // 0xFF = "timed out"
        b.turn = b.turn.checked_add(1).ok_or(ErrorCode::Overflow)?;
        Ok(())
    }

    /// ER. Cancels the pending turn timer (CancelTask CPI, signed by the battle PDA).
    #[session_auth_or(
        ctx.accounts.battle.mover() == ctx.accounts.signer.key(),
        SessionError::InvalidToken
    )]
    pub fn cancel_timer(ctx: Context<CancelTimer>) -> Result<()> {
        let bump = ctx.bumps.battle;
        let creator = ctx.accounts.battle.players[0];
        let task_id = ctx.accounts.battle.timer_task_id;
        ctx.accounts.battle.timer_armed = false;
        cancel_turn_timeout(
            &ctx.accounts.battle.to_account_info(),
            &creator,
            bump,
            task_id,
        )
    }

    // ------------------------------------------------------------------ commit / undelegate

    /// ER. Commit current state to the base layer, stay delegated.
    #[session_auth_or(
        ctx.accounts.battle.mover() == ctx.accounts.signer.key(),
        SessionError::InvalidToken
    )]
    pub fn commit_battle(ctx: Context<CommitBattle>) -> Result<()> {
        // NOTE: if you mutate `battle` in this same ix, call `ctx.accounts.battle.exit(&crate::ID)?;`
        // first so the Magic program snapshots the new bytes.
        MagicIntentBundleBuilder::new(
            ctx.accounts.signer.to_account_info(),
            ctx.accounts.magic_context.to_account_info(),
            ctx.accounts.magic_program.to_account_info(),
        )
        .commit(&[ctx.accounts.battle.to_account_info()])
        .build_and_invoke()?;
        Ok(())
    }

    /// ER. Final commit + undelegate (state returns to the base layer, account unlocked).
    #[session_auth_or(
        ctx.accounts.battle.mover() == ctx.accounts.signer.key(),
        SessionError::InvalidToken
    )]
    pub fn end_battle(ctx: Context<CommitBattle>) -> Result<()> {
        MagicIntentBundleBuilder::new(
            ctx.accounts.signer.to_account_info(),
            ctx.accounts.magic_context.to_account_info(),
            ctx.accounts.magic_program.to_account_info(),
        )
        .commit_and_undelegate(&[ctx.accounts.battle.to_account_info()])
        .build_and_invoke()?;
        Ok(())
    }
}

// ============================================================================ helpers

/// Task ids are validator-global, so derive a collision-resistant one from the battle PDA.
pub fn task_id_for(battle: &Pubkey) -> i64 {
    let mut b = [0u8; 8];
    b.copy_from_slice(&battle.as_ref()[0..8]);
    (u64::from_le_bytes(b) >> 1) as i64
}

/// ScheduleTask CPI, verbatim shape of docs/tools/crank/implementation.md (bincode + invoke_signed),
/// but with the battle PDA as the task authority (signs via seeds) and a crank-signer-protected
/// target instruction.
fn schedule_turn_timeout<'info>(
    battle: &AccountInfo<'info>,
    creator: &Pubkey,
    bump: u8,
    task_id: i64,
) -> Result<()> {
    let (crank_signer, _) = Pubkey::find_program_address(
        &[CRANK_SEED, battle.key.as_ref()],
        &Pubkey::new_from_array(CRANK_PROGRAM_ID.to_bytes()),
    );
    let timeout_ix = Instruction {
        program_id: crate::ID,
        accounts: vec![
            AccountMeta::new(*battle.key, false),
            AccountMeta::new_readonly(crank_signer, true),
        ],
        data: anchor_lang::InstructionData::data(&crate::instruction::TimeoutTurn {}),
    };
    let ix_data = bincode::serialize(&MagicBlockInstruction::ScheduleTask(ScheduleTaskArgs {
        task_id,
        execution_interval_millis: TURN_TIMEOUT_MS,
        iterations: 2, // #1 fires immediately (no-op), #2 fires after TURN_TIMEOUT_MS
        instructions: vec![timeout_ix],
    }))
    .map_err(|err| {
        msg!("ERROR: failed to serialize args {:?}", err);
        ProgramError::InvalidArgument
    })?;
    let schedule_ix = Instruction::new_with_bytes(
        Pubkey::new_from_array(MAGIC_PROGRAM_ID.to_bytes()),
        &ix_data,
        vec![AccountMeta::new(*battle.key, true)],
    );
    invoke_signed(
        &schedule_ix,
        &[battle.clone()],
        &[&[BATTLE_SEED, creator.as_ref(), &[bump]]],
    )?;
    Ok(())
}

fn cancel_turn_timeout<'info>(
    battle: &AccountInfo<'info>,
    creator: &Pubkey,
    bump: u8,
    task_id: i64,
) -> Result<()> {
    let ix_data = bincode::serialize(&MagicBlockInstruction::CancelTask { task_id })
        .map_err(|_| ProgramError::InvalidArgument)?;
    let cancel_ix = Instruction::new_with_bytes(
        Pubkey::new_from_array(MAGIC_PROGRAM_ID.to_bytes()),
        &ix_data,
        vec![AccountMeta::new(*battle.key, true)],
    );
    invoke_signed(
        &cancel_ix,
        &[battle.clone()],
        &[&[BATTLE_SEED, creator.as_ref(), &[bump]]],
    )?;
    Ok(())
}

// ============================================================================ state

#[account]
#[derive(InitSpace)]
pub struct Battle {
    pub players: [Pubkey; 2], // 64
    pub turn: u32,            // 4
    pub last_roll: u8,        // 1  <- written by the VRF callback
    pub roll_pending: bool,   // 1
    pub roll_turn: u32,       // 4  turn for which the live VRF request was made
    pub timer_deadline: i64,  // 8  unix ts (s) after which timeout_turn may apply
    pub timer_task_id: i64,   // 8
    pub timer_armed: bool,    // 1
    pub timer_turn: u32,      // 4  turn the timer was armed for
    pub timeouts: u8,         // 1
    pub hp: [u16; 2],         // 4
    pub log: [u8; 192],       // 192 move history ring buffer  => 8 + 292 = 300 bytes
}

impl Battle {
    /// account size on chain, discriminator included
    pub const SIZE: usize = 8 + Battle::INIT_SPACE;
    /// Player to move (even turn = players[0]).
    pub fn mover(&self) -> Pubkey {
        self.players[(self.turn % 2) as usize]
    }
}
const _: () = assert!(Battle::SIZE == 300);

#[error_code]
pub enum ErrorCode {
    #[msg("arithmetic overflow")]
    Overflow,
    #[msg("a VRF request is already pending")]
    RollAlreadyPending,
}

// ============================================================================ accounts

#[derive(Accounts)]
pub struct CreateBattle<'info> {
    #[account(init, payer = creator, space = Battle::SIZE, seeds = [BATTLE_SEED, creator.key().as_ref()], bump)]
    pub battle: Account<'info, Battle>,
    #[account(mut)]
    pub creator: Signer<'info>,
    pub system_program: Program<'info, System>,
}

/// `del` generates `delegate_pda(...)` (method name = `delegate_<field>`).
#[delegate]
#[derive(Accounts)]
pub struct DelegateBattle<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: the PDA to delegate; seeds are re-checked by the DLP CPI
    #[account(mut, del, seeds = [BATTLE_SEED, payer.key().as_ref()], bump)]
    pub pda: UncheckedAccount<'info>,
}

#[derive(Accounts, Session)]
pub struct PlayMove<'info> {
    #[account(mut, seeds = [BATTLE_SEED, battle.players[0].as_ref()], bump)]
    pub battle: Account<'info, Battle>,
    #[session(signer = signer, authority = battle.mover())]
    pub session_token: Option<Account<'info, SessionTokenV2>>,
    #[account(mut)]
    pub signer: Signer<'info>,
    pub magic_program: Program<'info, ephemeral_rollups_sdk::anchor::MagicProgram>,
}

#[vrf]
#[derive(Accounts, Session)]
pub struct RequestRoll<'info> {
    #[account(mut, seeds = [BATTLE_SEED, battle.players[0].as_ref()], bump)]
    pub battle: Account<'info, Battle>,
    #[session(signer = signer, authority = battle.mover())]
    pub session_token: Option<Account<'info, SessionTokenV2>>,
    #[account(mut)]
    pub signer: Signer<'info>,
    /// CHECK: one of the four known queues (docs pattern). On the ER use DEFAULT_EPHEMERAL_QUEUE
    /// (delegated queue), on the base layer DEFAULT_QUEUE; the VRF program validates it again.
    #[account(
        mut,
        constraint = oracle_queue.key() == vrf::consts::DEFAULT_QUEUE
            || oracle_queue.key() == vrf::consts::DEFAULT_TEST_QUEUE
            || oracle_queue.key() == vrf::consts::DEFAULT_EPHEMERAL_QUEUE
            || oracle_queue.key() == vrf::consts::DEFAULT_EPHEMERAL_TEST_QUEUE
    )]
    pub oracle_queue: UncheckedAccount<'info>,
}

#[vrf_callback]
#[derive(Accounts)]
pub struct CallbackRoll<'info> {
    #[account(mut)]
    pub battle: Account<'info, Battle>,
}

#[derive(Accounts)]
pub struct TimeoutTurn<'info> {
    #[account(mut, seeds = [BATTLE_SEED, battle.players[0].as_ref()], bump)]
    pub battle: Account<'info, Battle>,
    /// Only the validator's task scheduler can sign for this PDA.
    #[account(
        seeds = [CRANK_SEED, battle.key().as_ref()],
        bump,
        seeds::program = CRANK_PROGRAM_ID,
    )]
    pub crank_signer: Signer<'info>,
}

#[derive(Accounts, Session)]
pub struct CancelTimer<'info> {
    #[account(mut, seeds = [BATTLE_SEED, battle.players[0].as_ref()], bump)]
    pub battle: Account<'info, Battle>,
    #[session(signer = signer, authority = battle.mover())]
    pub session_token: Option<Account<'info, SessionTokenV2>>,
    #[account(mut)]
    pub signer: Signer<'info>,
    pub magic_program: Program<'info, ephemeral_rollups_sdk::anchor::MagicProgram>,
}

/// `#[commit]` injects `magic_program` and `magic_context`.
#[commit]
#[derive(Accounts, Session)]
pub struct CommitBattle<'info> {
    #[account(mut, seeds = [BATTLE_SEED, battle.players[0].as_ref()], bump)]
    pub battle: Account<'info, Battle>,
    #[session(signer = signer, authority = battle.mover())]
    pub session_token: Option<Account<'info, SessionTokenV2>>,
    #[account(mut)]
    pub signer: Signer<'info>,
}
