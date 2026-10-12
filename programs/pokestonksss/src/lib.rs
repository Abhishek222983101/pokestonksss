//! PokeStonksss — on-chain game program.
//!
//! Every player owns two PDAs that live on a MagicBlock Ephemeral Rollup: `Trainer` (rating, dex) and `Arena`
//! (one reusable battle slot). Battles run entirely on the ER; randomness comes from MagicBlock VRF requested
//! only after both picks are locked; live prices from MagicBlock's oracle shape damage ("market mood");
//! results are committed back to Solana in batches. Rules live in the shared `duel-rules` crate.
use anchor_lang::prelude::*;
use duel_rules::{bot_pick, resolve_turn, MatchState, Tier, NO_WINNER};
use ephemeral_rollups_sdk::anchor::{commit, delegate, ephemeral, vrf, vrf_callback};
use ephemeral_rollups_sdk::cpi::DelegateConfig;
use ephemeral_rollups_sdk::ephem::MagicIntentBundleBuilder;
use ephemeral_rollups_sdk::vrf::{
    self,
    instructions::{create_request_scoped_randomness_ix, RequestRandomnessParams},
    types::SerializableAccountMeta,
};

pub mod consts;
pub mod engine;
pub mod errors;
pub mod oracle;
pub mod state;

use consts::*;
use engine::*;
use errors::GameError;
use state::*;

declare_id!("FRxAb7Nw1GFyLkV7KN7fitTztiZuJ1y1oNEmcW3mHM1M");

/// Accounts the VRF callback needs, in order: arena, host trainer, [guest trainer], feed A, feed B.
fn roll_metas(a: &Arena, arena_key: Pubkey) -> Result<Vec<SerializableAccountMeta>> {
    let st = load_state(a)?;
    let w = |pubkey| SerializableAccountMeta { pubkey, is_signer: false, is_writable: true };
    let r = |pubkey| SerializableAccountMeta { pubkey, is_signer: false, is_writable: false };
    let mut v = vec![w(arena_key), w(trainer_pda(&a.host))];
    if a.mode == MODE_DUEL {
        v.push(w(trainer_pda(&a.guest)));
    }
    for i in 0..2 {
        let sp = duel_rules::species(st.f[i].species).ok_or(GameError::CorruptState)?;
        v.push(r(oracle::feed_pda(sp.feed)));
    }
    Ok(v)
}

pub fn trainer_pda(owner: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[TRAINER_SEED, owner.as_ref()], &ID).0
}

/// Builds and sends the VRF request for the current turn (macro: `invoke_signed_vrf` is generated per context).
macro_rules! request_roll {
    ($ctx:expr) => {{
        let now = Clock::get()?;
        let turn = load_state(&$ctx.accounts.arena)?.turn;
        let metas = roll_metas(&$ctx.accounts.arena, $ctx.accounts.arena.key())?;
        let seed = solana_sha256_hasher::hashv(&[
            $ctx.accounts.arena.key().as_ref(),
            &[turn],
            &now.slot.to_le_bytes(),
        ])
        .to_bytes();
        let ix = create_request_scoped_randomness_ix(RequestRandomnessParams {
            payer: $ctx.accounts.signer.key(),
            oracle_queue: $ctx.accounts.oracle_queue.key(),
            callback_program_id: ID,
            callback_discriminator: instruction::CallbackTurn::DISCRIMINATOR.to_vec(),
            caller_seed: seed,
            accounts_metas: Some(metas),
            callback_args: Some(vec![turn]),
            ..Default::default()
        });
        $ctx.accounts.invoke_signed_vrf(&$ctx.accounts.signer.to_account_info(), &ix)?;
        let a = &mut $ctx.accounts.arena;
        a.vrf_pending = true;
        a.rnd_turn = turn;
        a.phase = PHASE_ROLLING;
        a.updated_at = now.unix_timestamp;
    }};
}

/// A new match may start when the slot is idle/finished/waiting, when it holds only an abandoned practice battle
/// (the host is the only party and a stale VRF callback is ignored by the `vrf_pending`/`rnd_turn` guard), or when stuck.
fn startable(a: &Arena, now: i64) -> bool {
    matches!(a.phase, PHASE_IDLE | PHASE_FINISHED | PHASE_WAITING)
        || a.mode == MODE_PRACTICE
        || now - a.updated_at > STUCK_RESET_SECS
}

fn fresh(a: &mut Arena, mode: u8, host: Pubkey, guest: Pubkey, now: i64) {
    a.host = host;
    a.guest = guest;
    a.mode = mode;
    a.picks = [NO_PICK; 2];
    a.commits = [[0; 32]; 2];
    a.committed_mask = 0;
    a.revealed_mask = 0;
    a.vrf_pending = false;
    a.rnd_turn = 0;
    a.timeouts = [0; 2];
    a.snap = [0; 2];
    a.winner = NO_WINNER;
    a.log_len = 0;
    a.log = [[0; LOG_ENTRY]; LOG_SLOTS];
    a.opened_at = now;
    a.updated_at = now;
    a.deadline = 0;
}

fn snapshot(a: &mut Arena, st: &MatchState, fa: &AccountInfo, fb: &AccountInfo, now: i64) {
    a.snap[0] = oracle::read_species_price(fa, st.f[0].species, now).unwrap_or(0);
    a.snap[1] = oracle::read_species_price(fb, st.f[1].species, now).unwrap_or(0);
}

#[ephemeral]
#[program]
pub mod pokestonksss {
    use super::*;

    // ------------------------------------------------------------------------- base layer

    /// Creates the player's Trainer + Arena PDAs (once per player).
    pub fn onboard(ctx: Context<Onboard>, name_seed: u32) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let t = &mut ctx.accounts.trainer;
        t.owner = ctx.accounts.payer.key();
        t.rating = START_RATING;
        t.name_seed = name_seed;
        t.bump = ctx.bumps.trainer;
        let a = &mut ctx.accounts.arena;
        fresh(a, MODE_PRACTICE, ctx.accounts.payer.key(), Pubkey::default(), now);
        a.phase = PHASE_IDLE;
        a.tier = 1;
        a.state = MatchState::new(0, 0).ok_or(GameError::BadInput)?.to_bytes();
        a.bump = ctx.bumps.arena;
        Ok(())
    }

    /// Delegates Trainer + Arena to the ER validator passed as `remaining_accounts[0]`.
    pub fn delegate_all(ctx: Context<DelegateAll>) -> Result<()> {
        let validator = ctx.remaining_accounts.first().map(|a| a.key());
        let cfg = || DelegateConfig { validator, ..Default::default() };
        let payer_key = ctx.accounts.payer.key();
        ctx.accounts.delegate_trainer(&ctx.accounts.payer, &[TRAINER_SEED, payer_key.as_ref()], cfg())?;
        ctx.accounts.delegate_arena(&ctx.accounts.payer, &[ARENA_SEED, payer_key.as_ref()], cfg())?;
        Ok(())
    }

    // ------------------------------------------------------------------------- ER: practice

    /// Starts an instant practice battle against the House Agent.
    pub fn start_practice(ctx: Context<StartPractice>, species: u8, opp_species: u8, tier: u8) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        require!(species < MAX_SPECIES && opp_species < MAX_SPECIES && tier <= 4, GameError::BadInput);
        let a = &mut ctx.accounts.arena;
        require!(startable(a, now), GameError::WrongPhase);
        let host = ctx.accounts.signer.key();
        fresh(a, MODE_PRACTICE, host, Pubkey::default(), now);
        let st = MatchState::new(species, opp_species).ok_or(GameError::BadInput)?;
        a.state = st.to_bytes();
        a.tier = tier;
        snapshot(a, &st, &ctx.accounts.feed_a, &ctx.accounts.feed_b, now);
        a.phase = PHASE_PICKING;
        Ok(())
    }

    /// Practice: lock a move. The House Agent's reply is chosen inside the VRF callback, never from this pick.
    pub fn lock_pick(ctx: Context<LockPick>, slot: u8) -> Result<()> {
        {
            let a = &mut ctx.accounts.arena;
            require!(a.mode == MODE_PRACTICE && a.phase == PHASE_PICKING, GameError::WrongPhase);
            require!(!a.vrf_pending, GameError::RollPending);
            require!(ctx.accounts.signer.key() == a.host, GameError::NotAPlayer);
            require!(slot < 4, GameError::BadInput);
            a.picks[0] = slot;
        }
        request_roll!(ctx);
        Ok(())
    }

    // ------------------------------------------------------------------------- ER: duel

    pub fn open_duel(ctx: Context<OpenDuel>, species: u8, token_hash: [u8; 32]) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        require!(species < MAX_SPECIES, GameError::BadInput);
        let a = &mut ctx.accounts.arena;
        require!(startable(a, now), GameError::WrongPhase);
        let host = ctx.accounts.signer.key();
        fresh(a, MODE_DUEL, host, Pubkey::default(), now);
        a.state = MatchState::new(species, species).ok_or(GameError::BadInput)?.to_bytes();
        a.token_hash = token_hash;
        a.phase = PHASE_WAITING;
        Ok(())
    }

    pub fn cancel_duel(ctx: Context<HostArena>) -> Result<()> {
        let a = &mut ctx.accounts.arena;
        require!(a.phase == PHASE_WAITING, GameError::WrongPhase);
        a.phase = PHASE_IDLE;
        a.updated_at = Clock::get()?.unix_timestamp;
        Ok(())
    }

    /// Guest joins with the secret token from the invite link.
    pub fn join_duel(ctx: Context<JoinDuel>, species: u8, token: [u8; 32]) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        require!(species < MAX_SPECIES, GameError::BadInput);
        let a = &mut ctx.accounts.arena;
        require!(a.mode == MODE_DUEL && a.phase == PHASE_WAITING, GameError::WrongPhase);
        require!(now <= a.opened_at + DUEL_JOIN_WINDOW_SECS, GameError::InviteExpired);
        require!(token_hash(&token) == a.token_hash, GameError::BadToken);
        let guest = ctx.accounts.signer.key();
        require!(guest != a.host, GameError::SelfDuel);
        let host_species = load_state(a)?.f[0].species;
        let st = MatchState::new(host_species, species).ok_or(GameError::BadInput)?;
        a.state = st.to_bytes();
        a.guest = guest;
        snapshot(a, &st, &ctx.accounts.feed_a, &ctx.accounts.feed_b, now);
        a.phase = PHASE_PICKING;
        a.deadline = now + TURN_TIMEOUT_SECS;
        a.updated_at = now;
        Ok(())
    }

    /// Duel: seal a pick as sha256(slot ‖ salt ‖ arena ‖ turn ‖ player).
    pub fn commit_pick(ctx: Context<DuelAction>, commitment_hash: [u8; 32]) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let a = &mut ctx.accounts.arena;
        require!(a.mode == MODE_DUEL && a.phase == PHASE_PICKING, GameError::WrongPhase);
        let seat = a.seat_of(&ctx.accounts.signer.key()).ok_or(GameError::NotAPlayer)?;
        require!(a.committed_mask & (1 << seat) == 0, GameError::WrongPhase);
        a.commits[seat] = commitment_hash;
        a.committed_mask |= 1 << seat;
        a.timeouts[seat] = 0;
        a.updated_at = now;
        if a.committed_mask == 3 {
            a.phase = PHASE_REVEALING;
            a.deadline = now + TURN_TIMEOUT_SECS;
        }
        Ok(())
    }

    /// Duel: reveal. The second reveal requests the VRF roll.
    pub fn reveal_pick(ctx: Context<RevealPick>, slot: u8, salt: [u8; 32]) -> Result<()> {
        let arena_key = ctx.accounts.arena.key();
        let both = {
            let a = &mut ctx.accounts.arena;
            require!(a.mode == MODE_DUEL && a.phase == PHASE_REVEALING, GameError::WrongPhase);
            require!(slot < 4, GameError::BadInput);
            let who = ctx.accounts.signer.key();
            let seat = a.seat_of(&who).ok_or(GameError::NotAPlayer)?;
            require!(a.revealed_mask & (1 << seat) == 0, GameError::WrongPhase);
            let turn = load_state(a)?.turn;
            require!(commitment(slot, &salt, &arena_key, turn, &who) == a.commits[seat], GameError::BadReveal);
            a.picks[seat] = slot;
            a.revealed_mask |= 1 << seat;
            a.timeouts[seat] = 0;
            a.revealed_mask == 3
        };
        if both {
            request_roll!(ctx);
        }
        Ok(())
    }

    /// Anyone may call after the deadline: missing steps default to GUARD; two timeouts in a row forfeit.
    pub fn claim_timeout(ctx: Context<ClaimTimeout>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let both = {
        let a = &mut ctx.accounts.arena;
        require!(a.mode == MODE_DUEL && matches!(a.phase, PHASE_PICKING | PHASE_REVEALING), GameError::WrongPhase);
        require!(now > a.deadline, GameError::NotYetDue);
        let reveal_phase = a.phase == PHASE_REVEALING;
        for i in 0..2usize {
            let done = if reveal_phase { a.revealed_mask } else { a.committed_mask } & (1 << i) != 0;
            if !done {
                a.timeouts[i] = a.timeouts[i].saturating_add(1);
                a.picks[i] = 2; // GUARD
                a.committed_mask |= 1 << i;
                a.revealed_mask |= 1 << i;
            }
        }
        if let Some(loser) = (0..2usize).find(|&i| a.timeouts[i] >= 2) {
            a.winner = 1 - loser as u8;
            finish(a, &mut ctx.accounts.host_trainer, Some(&mut ctx.accounts.guest_trainer))?;
            return Ok(());
        }
        if a.revealed_mask != 3 {
            a.phase = PHASE_REVEALING;
            a.deadline = now + TURN_TIMEOUT_SECS;
        }
        a.revealed_mask == 3
        };
        if both {
            request_roll!(ctx);
        }
        Ok(())
    }

    /// Concede a duel.
    pub fn forfeit(ctx: Context<Forfeit>) -> Result<()> {
        let a = &mut ctx.accounts.arena;
        require!(a.mode == MODE_DUEL && matches!(a.phase, PHASE_PICKING | PHASE_REVEALING), GameError::WrongPhase);
        let seat = a.seat_of(&ctx.accounts.signer.key()).ok_or(GameError::NotAPlayer)?;
        a.winner = 1 - seat as u8;
        finish(a, &mut ctx.accounts.host_trainer, Some(&mut ctx.accounts.guest_trainer))?;
        Ok(())
    }

    /// Host may always get a clean arena back (never leaves a player stuck).
    pub fn reset_arena(ctx: Context<HostArena>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let a = &mut ctx.accounts.arena;
        require!(
            matches!(a.phase, PHASE_IDLE | PHASE_WAITING | PHASE_FINISHED) || now - a.updated_at > STUCK_RESET_SECS,
            GameError::CannotReset
        );
        a.phase = PHASE_IDLE;
        a.vrf_pending = false;
        a.picks = [NO_PICK; 2];
        a.committed_mask = 0;
        a.revealed_mask = 0;
        a.updated_at = now;
        Ok(())
    }

    // ------------------------------------------------------------------------- VRF callback

    /// Called by the VRF oracle (identity enforced by `#[vrf_callback]`). Idempotent: stale/duplicate callbacks are ignored.
    pub fn callback_turn(ctx: Context<CallbackTurn>, randomness: [u8; 32], for_turn: u8) -> Result<()> {
        let a = &mut ctx.accounts.arena;
        if !a.vrf_pending || a.rnd_turn != for_turn || a.phase != PHASE_ROLLING {
            msg!("stale or duplicate VRF callback ignored");
            return Ok(());
        }
        let now = Clock::get()?.unix_timestamp;
        let duel = a.mode == MODE_DUEL;
        let rem = ctx.remaining_accounts;
        let off = if duel { 1 } else { 0 };
        require!(rem.len() >= off + 2, GameError::BadInput);

        let mut st = load_state(a)?;
        let picks = if duel {
            a.picks
        } else {
            let tier = Tier::from_u8(a.tier).ok_or(GameError::BadInput)?;
            // The House Agent sees only public match state + fresh randomness, never the human's pick.
            [a.picks[0], bot_pick(&st, 1, &randomness, tier)]
        };
        let mood = [
            oracle::mood(a.snap[0], oracle::read_species_price(&rem[off], st.f[0].species, now)),
            oracle::mood(a.snap[1], oracle::read_species_price(&rem[off + 1], st.f[1].species, now)),
        ];
        a.vrf_pending = false;
        let _events = resolve_turn(&mut st, picks, &randomness, mood);
        push_log(a, picks, &randomness, mood);
        a.state = st.to_bytes();
        a.picks = [NO_PICK; 2];
        a.committed_mask = 0;
        a.revealed_mask = 0;
        a.updated_at = now;
        if st.is_over() {
            a.winner = st.winner;
            if duel {
                let mut guest: Account<Trainer> = Account::try_from(&rem[0])?;
                finish(a, &mut ctx.accounts.host_trainer, Some(&mut guest))?;
                guest.exit(&ID)?;
            } else {
                finish(a, &mut ctx.accounts.host_trainer, None)?;
            }
        } else {
            a.phase = PHASE_PICKING;
            a.deadline = if duel { now + TURN_TIMEOUT_SECS } else { 0 };
        }
        Ok(())
    }

    // ------------------------------------------------------------------------- commit to Solana

    /// Commits the Trainer to the base layer ("Saved to Solana"). Stays delegated.
    pub fn commit_trainer(ctx: Context<CommitTrainer>) -> Result<()> {
        let t = &mut ctx.accounts.trainer;
        t.unsaved = 0;
        t.commits = t.commits.saturating_add(1);
        t.exit(&ID)?;
        MagicIntentBundleBuilder::new(
            ctx.accounts.signer.to_account_info(),
            ctx.accounts.magic_context.to_account_info(),
            ctx.accounts.magic_program.to_account_info(),
        )
        .commit(&[ctx.accounts.trainer.to_account_info()])
        .build_and_invoke()?;
        Ok(())
    }

    /// Final commit + undelegate of Trainer and Arena (leave the rollup).
    pub fn save_and_leave(ctx: Context<SaveAndLeave>) -> Result<()> {
        let t = &mut ctx.accounts.trainer;
        t.unsaved = 0;
        t.commits = t.commits.saturating_add(1);
        t.exit(&ID)?;
        MagicIntentBundleBuilder::new(
            ctx.accounts.signer.to_account_info(),
            ctx.accounts.magic_context.to_account_info(),
            ctx.accounts.magic_program.to_account_info(),
        )
        .commit_and_undelegate(&[ctx.accounts.trainer.to_account_info(), ctx.accounts.arena.to_account_info()])
        .build_and_invoke()?;
        Ok(())
    }
}

/// Ends a match: winner already set. Updates trainers and parks the arena in FINISHED.
fn finish(a: &mut Arena, host: &mut Trainer, guest: Option<&mut Trainer>) -> Result<()> {
    let st = load_state(a)?;
    a.vrf_pending = false;
    a.phase = PHASE_FINISHED;
    a.updated_at = Clock::get()?.unix_timestamp;
    let guest = if a.mode == MODE_DUEL { guest } else { None };
    settle(a, &st, host, guest);
    Ok(())
}

// ============================================================================ account contexts

#[derive(Accounts)]
pub struct Onboard<'info> {
    #[account(init, payer = payer, space = 8 + Trainer::INIT_SPACE, seeds = [TRAINER_SEED, payer.key().as_ref()], bump)]
    pub trainer: Account<'info, Trainer>,
    #[account(init, payer = payer, space = 8 + Arena::INIT_SPACE, seeds = [ARENA_SEED, payer.key().as_ref()], bump)]
    pub arena: Account<'info, Arena>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[delegate]
#[derive(Accounts)]
pub struct DelegateAll<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: delegated by the DLP CPI; seeds re-checked there
    #[account(mut, del, seeds = [TRAINER_SEED, payer.key().as_ref()], bump)]
    pub trainer: UncheckedAccount<'info>,
    /// CHECK: delegated by the DLP CPI; seeds re-checked there
    #[account(mut, del, seeds = [ARENA_SEED, payer.key().as_ref()], bump)]
    pub arena: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct StartPractice<'info> {
    #[account(mut, seeds = [ARENA_SEED, signer.key().as_ref()], bump = arena.bump)]
    pub arena: Account<'info, Arena>,
    #[account(seeds = [TRAINER_SEED, signer.key().as_ref()], bump = trainer.bump)]
    pub trainer: Account<'info, Trainer>,
    #[account(mut)]
    pub signer: Signer<'info>,
    /// CHECK: price feed of the player's species (validated by PDA inside)
    pub feed_a: UncheckedAccount<'info>,
    /// CHECK: price feed of the opponent species (validated by PDA inside)
    pub feed_b: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct OpenDuel<'info> {
    #[account(mut, seeds = [ARENA_SEED, signer.key().as_ref()], bump = arena.bump)]
    pub arena: Account<'info, Arena>,
    #[account(seeds = [TRAINER_SEED, signer.key().as_ref()], bump = trainer.bump)]
    pub trainer: Account<'info, Trainer>,
    #[account(mut)]
    pub signer: Signer<'info>,
}

#[derive(Accounts)]
pub struct HostArena<'info> {
    #[account(mut, seeds = [ARENA_SEED, signer.key().as_ref()], bump = arena.bump)]
    pub arena: Account<'info, Arena>,
    #[account(mut)]
    pub signer: Signer<'info>,
}

#[derive(Accounts)]
pub struct JoinDuel<'info> {
    #[account(mut, seeds = [ARENA_SEED, arena.host.as_ref()], bump = arena.bump)]
    pub arena: Account<'info, Arena>,
    /// The guest must be onboarded (its Trainer is updated at settlement).
    #[account(seeds = [TRAINER_SEED, signer.key().as_ref()], bump = guest_trainer.bump)]
    pub guest_trainer: Account<'info, Trainer>,
    #[account(mut)]
    pub signer: Signer<'info>,
    /// CHECK: host species feed
    pub feed_a: UncheckedAccount<'info>,
    /// CHECK: guest species feed
    pub feed_b: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct DuelAction<'info> {
    #[account(mut, seeds = [ARENA_SEED, arena.host.as_ref()], bump = arena.bump)]
    pub arena: Account<'info, Arena>,
    #[account(mut)]
    pub signer: Signer<'info>,
}

#[vrf]
#[derive(Accounts)]
pub struct LockPick<'info> {
    #[account(mut, seeds = [ARENA_SEED, arena.host.as_ref()], bump = arena.bump)]
    pub arena: Account<'info, Arena>,
    #[account(mut)]
    pub signer: Signer<'info>,
    /// CHECK: must be the delegated (ER) VRF queue; the VRF program validates it again
    #[account(
        mut,
        constraint = oracle_queue.key() == vrf::consts::DEFAULT_EPHEMERAL_QUEUE
            || oracle_queue.key() == vrf::consts::DEFAULT_EPHEMERAL_TEST_QUEUE
    )]
    pub oracle_queue: UncheckedAccount<'info>,
}

#[vrf]
#[derive(Accounts)]
pub struct RevealPick<'info> {
    #[account(mut, seeds = [ARENA_SEED, arena.host.as_ref()], bump = arena.bump)]
    pub arena: Account<'info, Arena>,
    #[account(mut)]
    pub signer: Signer<'info>,
    /// CHECK: delegated (ER) VRF queue
    #[account(
        mut,
        constraint = oracle_queue.key() == vrf::consts::DEFAULT_EPHEMERAL_QUEUE
            || oracle_queue.key() == vrf::consts::DEFAULT_EPHEMERAL_TEST_QUEUE
    )]
    pub oracle_queue: UncheckedAccount<'info>,
}

#[vrf]
#[derive(Accounts)]
pub struct ClaimTimeout<'info> {
    #[account(mut, seeds = [ARENA_SEED, arena.host.as_ref()], bump = arena.bump)]
    pub arena: Account<'info, Arena>,
    #[account(mut, seeds = [TRAINER_SEED, arena.host.as_ref()], bump = host_trainer.bump)]
    pub host_trainer: Account<'info, Trainer>,
    #[account(mut, seeds = [TRAINER_SEED, arena.guest.as_ref()], bump = guest_trainer.bump)]
    pub guest_trainer: Account<'info, Trainer>,
    #[account(mut)]
    pub signer: Signer<'info>,
    /// CHECK: delegated (ER) VRF queue
    #[account(
        mut,
        constraint = oracle_queue.key() == vrf::consts::DEFAULT_EPHEMERAL_QUEUE
            || oracle_queue.key() == vrf::consts::DEFAULT_EPHEMERAL_TEST_QUEUE
    )]
    pub oracle_queue: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct Forfeit<'info> {
    #[account(mut, seeds = [ARENA_SEED, arena.host.as_ref()], bump = arena.bump)]
    pub arena: Account<'info, Arena>,
    #[account(mut, seeds = [TRAINER_SEED, arena.host.as_ref()], bump = host_trainer.bump)]
    pub host_trainer: Account<'info, Trainer>,
    #[account(mut, seeds = [TRAINER_SEED, arena.guest.as_ref()], bump = guest_trainer.bump)]
    pub guest_trainer: Account<'info, Trainer>,
    #[account(mut)]
    pub signer: Signer<'info>,
}

#[vrf_callback]
#[derive(Accounts)]
pub struct CallbackTurn<'info> {
    #[account(mut)]
    pub arena: Account<'info, Arena>,
    #[account(mut, constraint = host_trainer.owner == arena.host)]
    pub host_trainer: Account<'info, Trainer>,
}

#[commit]
#[derive(Accounts)]
pub struct CommitTrainer<'info> {
    #[account(mut, seeds = [TRAINER_SEED, signer.key().as_ref()], bump = trainer.bump)]
    pub trainer: Account<'info, Trainer>,
    #[account(mut)]
    pub signer: Signer<'info>,
}

#[commit]
#[derive(Accounts)]
pub struct SaveAndLeave<'info> {
    #[account(mut, seeds = [TRAINER_SEED, signer.key().as_ref()], bump = trainer.bump)]
    pub trainer: Account<'info, Trainer>,
    #[account(mut, seeds = [ARENA_SEED, signer.key().as_ref()], bump = arena.bump)]
    pub arena: Account<'info, Arena>,
    #[account(mut)]
    pub signer: Signer<'info>,
}
