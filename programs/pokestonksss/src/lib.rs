//! PokeStonksss — on-chain game program (season 2: session keys, levels and evolutions, badge tokens, crank).
//!
//! Every player owns two PDAs that live on a MagicBlock Ephemeral Rollup: `Trainer` (rating, dex) and `Arena`
//! (one reusable battle slot). Battles run entirely on the ER; randomness comes from MagicBlock VRF requested
//! only after both picks are locked; live prices from MagicBlock's oracle shape damage ("market mood");
//! results are committed back to Solana in batches. Player actions accept either the wallet or a MagicBlock session key,
//! a crank settles abandoned duels, and committed progress mints badge tokens on the base layer.
//! Rules live in the shared `duel-rules` crate.
use anchor_lang::prelude::*;
use anchor_lang::solana_program::{
    instruction::{AccountMeta, Instruction},
    program::invoke_signed,
};
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Mint, MintTo, Token, TokenAccount};
use duel_rules::{bot_level, bot_pick, level_for_xp, resolve_turn, MatchState, Tier, NO_WINNER};
use ephemeral_rollups_sdk::anchor::{commit, delegate, ephemeral, vrf, vrf_callback};
use ephemeral_rollups_sdk::cpi::DelegateConfig;
use ephemeral_rollups_sdk::ephem::MagicIntentBundleBuilder;
use ephemeral_rollups_sdk::consts::MAGIC_PROGRAM_ID;
use magicblock_magic_program_api::{args::ScheduleTaskArgs, instruction::MagicBlockInstruction, CRANK_PROGRAM_ID};
use session_keys::{session_auth_or, Session, SessionError, SessionTokenV2};
use ephemeral_rollups_sdk::vrf::{
    self,
    instructions::{create_request_scoped_randomness_ix, RequestRandomnessParams},
    types::SerializableAccountMeta,
};

pub mod consts;
pub mod engine;
pub mod errors;
pub mod oracle;
pub mod sealed;
pub mod state;

use consts::*;
use engine::*;
use errors::GameError;
pub use sealed::*;
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
    pub fn onboard(ctx: Context<Onboard>, name_seed: u32, avatar: u8) -> Result<()> {
        require!(avatar < 6, GameError::BadInput);
        let now = Clock::get()?.unix_timestamp;
        let t = &mut ctx.accounts.trainer;
        t.owner = ctx.accounts.payer.key();
        t.rating = START_RATING;
        t.name_seed = name_seed;
        t.avatar = avatar;
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
    #[session_auth_or(ctx.accounts.trainer.owner == ctx.accounts.signer.key(), SessionError::InvalidToken)]
    pub fn start_practice(ctx: Context<StartPractice>, species: u8, opp_species: u8, tier: u8) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        require!(species < MAX_SPECIES && opp_species < MAX_SPECIES && tier <= 4, GameError::BadInput);
        let host = ctx.accounts.trainer.owner;
        let player_level = level_for_xp(ctx.accounts.trainer.xp[species as usize]);
        let foe_level = bot_level(Tier::from_u8(tier).ok_or(GameError::BadInput)?, player_level);
        let a = &mut ctx.accounts.arena;
        require!(startable(a, now), GameError::WrongPhase);
        fresh(a, MODE_PRACTICE, host, Pubkey::default(), now);
        let st = MatchState::with_levels(species, player_level, opp_species, foe_level).ok_or(GameError::BadInput)?;
        a.state = st.to_bytes();
        a.tier = tier;
        snapshot(a, &st, &ctx.accounts.feed_a, &ctx.accounts.feed_b, now);
        a.phase = PHASE_PICKING;
        Ok(())
    }

    /// Practice: lock a move. The House Agent's reply is chosen inside the VRF callback, never from this pick.
    #[session_auth_or(ctx.accounts.arena.host == ctx.accounts.signer.key(), SessionError::InvalidToken)]
    pub fn lock_pick(ctx: Context<LockPick>, slot: u8) -> Result<()> {
        {
            let a = &mut ctx.accounts.arena;
            require!(a.mode == MODE_PRACTICE && a.phase == PHASE_PICKING, GameError::WrongPhase);
            require!(!a.vrf_pending, GameError::RollPending);
            require!(slot < 4, GameError::BadInput);
            a.picks[0] = slot;
        }
        request_roll!(ctx);
        Ok(())
    }

    // ------------------------------------------------------------------------- ER: duel

    #[session_auth_or(ctx.accounts.trainer.owner == ctx.accounts.signer.key(), SessionError::InvalidToken)]
    pub fn open_duel(ctx: Context<OpenDuel>, species: u8, token_hash: [u8; 32]) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        require!(species < MAX_SPECIES, GameError::BadInput);
        let host = ctx.accounts.trainer.owner;
        let level = level_for_xp(ctx.accounts.trainer.xp[species as usize]);
        let a = &mut ctx.accounts.arena;
        require!(startable(a, now), GameError::WrongPhase);
        fresh(a, MODE_DUEL, host, Pubkey::default(), now);
        a.state = MatchState::with_levels(species, level, species, 0).ok_or(GameError::BadInput)?.to_bytes();
        a.token_hash = token_hash;
        a.phase = PHASE_WAITING;
        Ok(())
    }

    #[session_auth_or(ctx.accounts.arena.host == ctx.accounts.signer.key(), SessionError::InvalidToken)]
    pub fn cancel_duel(ctx: Context<HostArena>) -> Result<()> {
        let a = &mut ctx.accounts.arena;
        require!(a.phase == PHASE_WAITING, GameError::WrongPhase);
        a.phase = PHASE_IDLE;
        a.updated_at = Clock::get()?.unix_timestamp;
        Ok(())
    }

    /// Guest joins with the secret token from the invite link.
    #[session_auth_or(ctx.accounts.guest_trainer.owner == ctx.accounts.signer.key(), SessionError::InvalidToken)]
    pub fn join_duel(ctx: Context<JoinDuel>, species: u8, token: [u8; 32]) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        require!(species < MAX_SPECIES, GameError::BadInput);
        let guest = ctx.accounts.guest_trainer.owner;
        let guest_level = level_for_xp(ctx.accounts.guest_trainer.xp[species as usize]);
        let a = &mut ctx.accounts.arena;
        require!(a.mode == MODE_DUEL && a.phase == PHASE_WAITING, GameError::WrongPhase);
        require!(now <= a.opened_at + DUEL_JOIN_WINDOW_SECS, GameError::InviteExpired);
        require!(token_hash(&token) == a.token_hash, GameError::BadToken);
        require!(guest != a.host, GameError::SelfDuel);
        let host_state = load_state(a)?;
        let st = MatchState::with_levels(host_state.f[0].species, host_state.f[0].level, species, guest_level).ok_or(GameError::BadInput)?;
        a.state = st.to_bytes();
        a.guest = guest;
        snapshot(a, &st, &ctx.accounts.feed_a, &ctx.accounts.feed_b, now);
        a.phase = PHASE_PICKING;
        a.deadline = now + TURN_TIMEOUT_SECS;
        a.updated_at = now;
        Ok(())
    }

    /// Duel: seal a pick as sha256(slot ‖ salt ‖ arena ‖ turn ‖ player).
    #[session_auth_or(ctx.accounts.trainer.owner == ctx.accounts.signer.key(), SessionError::InvalidToken)]
    pub fn commit_pick(ctx: Context<DuelAction>, commitment_hash: [u8; 32]) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let who = ctx.accounts.trainer.owner;
        let a = &mut ctx.accounts.arena;
        require!(a.mode == MODE_DUEL && a.phase == PHASE_PICKING, GameError::WrongPhase);
        let seat = a.seat_of(&who).ok_or(GameError::NotAPlayer)?;
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
    #[session_auth_or(ctx.accounts.trainer.owner == ctx.accounts.signer.key(), SessionError::InvalidToken)]
    pub fn reveal_pick(ctx: Context<RevealPick>, slot: u8, salt: [u8; 32]) -> Result<()> {
        let arena_key = ctx.accounts.arena.key();
        let who = ctx.accounts.trainer.owner;
        let both = {
            let a = &mut ctx.accounts.arena;
            require!(a.mode == MODE_DUEL && a.phase == PHASE_REVEALING, GameError::WrongPhase);
            require!(slot < 4, GameError::BadInput);
            let seat = a.seat_of(&who).ok_or(GameError::NotAPlayer)?;
            require!(a.revealed_mask & (1 << seat) == 0, GameError::WrongPhase);
            let turn = load_state(a)?.turn;
            require!(commitment(slot, &salt, &arena_key, turn, &who) == a.commits[seat], GameError::BadReveal);
            a.picks[seat] = slot;
            a.revealed_mask |= 1 << seat;
            a.timeouts[seat] = 0;
            a.updated_at = Clock::get()?.unix_timestamp;
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

    /// Concede a duel. `actor` is the conceding player's Trainer (read only); the signer is the wallet or its session key.
    #[session_auth_or(ctx.accounts.actor.owner == ctx.accounts.signer.key(), SessionError::InvalidToken)]
    pub fn forfeit(ctx: Context<Forfeit>) -> Result<()> {
        let who = ctx.accounts.actor.owner;
        let a = &mut ctx.accounts.arena;
        require!(a.mode == MODE_DUEL && matches!(a.phase, PHASE_PICKING | PHASE_REVEALING), GameError::WrongPhase);
        let seat = a.seat_of(&who).ok_or(GameError::NotAPlayer)?;
        a.winner = 1 - seat as u8;
        finish(a, &mut ctx.accounts.host_trainer, Some(&mut ctx.accounts.guest_trainer))?;
        Ok(())
    }

    /// Host may always get a clean arena back (never leaves a player stuck).
    #[session_auth_or(ctx.accounts.arena.host == ctx.accounts.signer.key(), SessionError::InvalidToken)]
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

    // ------------------------------------------------------------------------- sealed duels (Private ER / TEE)

    /// Base layer. Host opens a sealed duel; `host` is the per-match key that will sign inside the TEE.
    pub fn s_create(ctx: Context<SCreate>, host: Pubkey, species: u8, token_hash: [u8; 32]) -> Result<()> {
        sealed::create(ctx, host, species, token_hash)
    }
    /// Base layer. Guest joins with the invite token and their own per-match key.
    pub fn s_join(ctx: Context<SJoin>, guest: Pubkey, species: u8, token: [u8; 32]) -> Result<()> {
        sealed::join(ctx, guest, species, token)
    }
    /// Base layer. Requests the duel seed from MagicBlock VRF (before delegation).
    pub fn s_request_seed(ctx: Context<SRequestSeed>) -> Result<()> {
        sealed::request_seed(ctx)
    }
    /// Base layer VRF callback.
    pub fn s_consume_seed(ctx: Context<SConsumeSeed>, randomness: [u8; 32]) -> Result<()> {
        sealed::consume_seed(ctx, randomness)
    }
    /// Base layer. Delegates the duel or one pick to the TEE validator.
    pub fn s_delegate(ctx: Context<SDelegate>, account: SealedAccount) -> Result<()> {
        sealed::delegate_one(ctx, account)
    }
    /// Base layer. Host cancels an invite nobody joined.
    pub fn s_cancel(ctx: Context<SCancel>) -> Result<()> {
        sealed::cancel(ctx)
    }
    /// TEE. Creates the private permissions on both picks and flips the duel live.
    pub fn s_open(ctx: Context<SOpen>) -> Result<()> {
        sealed::open(ctx)
    }
    /// TEE. Seal a pick (slot + secret nonce) into the player's private pick account.
    pub fn s_lock(ctx: Context<SLock>, slot: u8, nonce: u64) -> Result<()> {
        sealed::lock(ctx, slot, nonce)
    }
    /// TEE. Anyone resolves the turn once both picks are sealed.
    pub fn s_resolve(ctx: Context<SResolve>) -> Result<()> {
        sealed::resolve(ctx)
    }
    /// TEE. Permissionless timeout for a duel a player walked away from.
    pub fn s_timeout(ctx: Context<STimeout>) -> Result<()> {
        sealed::timeout(ctx)
    }
    /// TEE. Commit the finished duel to Solana and undelegate.
    pub fn s_finish(ctx: Context<SFinish>) -> Result<()> {
        sealed::finish(ctx)
    }

    // ------------------------------------------------------------------------- crank

    /// ER. (Re)arms the MagicBlock crank sweep for this duel: every 20 s for ~3 minutes the validator's task scheduler
    /// calls `crank_timeout`, which settles the duel if it has been idle for `ABANDON_SECS`. Replaces the previous task.
    #[session_auth_or(ctx.accounts.trainer.owner == ctx.accounts.signer.key(), SessionError::InvalidToken)]
    pub fn arm_timer(ctx: Context<ArmTimer>) -> Result<()> {
        let a = &ctx.accounts.arena;
        require!(a.mode == MODE_DUEL && matches!(a.phase, PHASE_PICKING | PHASE_REVEALING | PHASE_ROLLING), GameError::WrongPhase);
        require!(a.seat_of(&ctx.accounts.trainer.owner).is_some(), GameError::NotAPlayer);
        let (host, guest, bump) = (a.host, a.guest, a.bump);
        schedule_sweep(&ctx.accounts.arena.to_account_info(), &host, &guest, bump)
    }

    /// ER, crank only (the signer is the task scheduler's PDA). Idle duels are settled: the side that failed to act
    /// forfeits; if neither acted the duel is closed without a result.
    pub fn crank_timeout(ctx: Context<CrankTimeout>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let a = &mut ctx.accounts.arena;
        if a.mode != MODE_DUEL || !matches!(a.phase, PHASE_PICKING | PHASE_REVEALING) || now - a.updated_at < ABANDON_SECS {
            msg!("crank_timeout: nothing to settle");
            return Ok(());
        }
        let mask = if a.phase == PHASE_REVEALING { a.revealed_mask } else { a.committed_mask };
        a.winner = match (mask & 1 != 0, mask & 2 != 0) {
            (true, false) => 0,
            (false, true) => 1,
            _ => NO_WINNER,
        };
        finish(a, &mut ctx.accounts.host_trainer, Some(&mut ctx.accounts.guest_trainer))?;
        msg!("crank_timeout: idle duel settled");
        Ok(())
    }

    // ------------------------------------------------------------------------- badges (base layer)

    /// Base layer, permissionless: mints badge `id` (an SPL token, supply 1 per owner) to the owner of a Trainer that
    /// has earned it. The check reads the Trainer's last committed state, so progress must be saved to Solana first.
    pub fn mint_badge(ctx: Context<MintBadge>, id: u8) -> Result<()> {
        require!(id < BADGES, GameError::BadInput);
        let t = {
            let data = ctx.accounts.trainer.try_borrow_data()?;
            Trainer::try_deserialize(&mut &data[..])?
        };
        require!(t.owner == ctx.accounts.owner.key(), GameError::NotAPlayer);
        require!(badge_earned(id, &t), GameError::BadgeNotEarned);
        let signer_seeds: &[&[&[u8]]] = &[&[BADGE_AUTH_SEED, &[ctx.bumps.badge_authority]]];
        token::mint_to(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.key(),
                MintTo {
                    mint: ctx.accounts.badge_mint.to_account_info(),
                    to: ctx.accounts.owner_ata.to_account_info(),
                    authority: ctx.accounts.badge_authority.to_account_info(),
                },
                signer_seeds,
            ),
            1,
        )?;
        let c = &mut ctx.accounts.claim;
        c.owner = ctx.accounts.owner.key();
        c.id = id;
        c.slot = Clock::get()?.slot;
        Ok(())
    }

    // ------------------------------------------------------------------------- commit to Solana

    /// Commits the Trainer to the base layer ("Saved to Solana"). Stays delegated.
    #[session_auth_or(ctx.accounts.trainer.owner == ctx.accounts.signer.key(), SessionError::InvalidToken)]
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

/// Task ids are validator-global: derive a collision-resistant one from the arena PDA.
pub fn task_id_for(arena: &Pubkey) -> i64 {
    let mut b = [0u8; 8];
    b.copy_from_slice(&arena.as_ref()[0..8]);
    (u64::from_le_bytes(b) >> 1) as i64
}

/// ScheduleTask CPI (bincode + invoke_signed, docs/tools/crank/implementation) with the arena PDA as task authority.
fn schedule_sweep<'info>(arena: &AccountInfo<'info>, host: &Pubkey, guest: &Pubkey, bump: u8) -> Result<()> {
    let (crank_signer, _) =
        Pubkey::find_program_address(&[CRANK_SEED, arena.key.as_ref()], &Pubkey::new_from_array(CRANK_PROGRAM_ID.to_bytes()));
    let sweep = Instruction {
        program_id: crate::ID,
        accounts: vec![
            AccountMeta::new(*arena.key, false),
            AccountMeta::new_readonly(crank_signer, true),
            AccountMeta::new(trainer_pda(host), false),
            AccountMeta::new(trainer_pda(guest), false),
        ],
        data: anchor_lang::InstructionData::data(&instruction::CrankTimeout {}),
    };
    let data = bincode::serialize(&MagicBlockInstruction::ScheduleTask(ScheduleTaskArgs {
        task_id: task_id_for(arena.key),
        execution_interval_millis: CRANK_INTERVAL_MS,
        iterations: CRANK_ITERATIONS,
        instructions: vec![sweep],
    }))
    .map_err(|_| ProgramError::InvalidArgument)?;
    let ix = Instruction::new_with_bytes(
        Pubkey::new_from_array(MAGIC_PROGRAM_ID.to_bytes()),
        &data,
        vec![AccountMeta::new(*arena.key, true)],
    );
    invoke_signed(&ix, &[arena.clone()], &[&[ARENA_SEED, host.as_ref(), &[bump]]])?;
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

#[derive(Accounts, Session)]
pub struct StartPractice<'info> {
    #[account(mut, seeds = [ARENA_SEED, trainer.owner.as_ref()], bump = arena.bump)]
    pub arena: Account<'info, Arena>,
    #[account(seeds = [TRAINER_SEED, trainer.owner.as_ref()], bump = trainer.bump)]
    pub trainer: Account<'info, Trainer>,
    #[session(signer = signer, authority = trainer.owner.key())]
    pub session_token: Option<Account<'info, SessionTokenV2>>,
    #[account(mut)]
    pub signer: Signer<'info>,
    /// CHECK: price feed of the player's species (validated by PDA inside)
    pub feed_a: UncheckedAccount<'info>,
    /// CHECK: price feed of the opponent species (validated by PDA inside)
    pub feed_b: UncheckedAccount<'info>,
}

#[derive(Accounts, Session)]
pub struct OpenDuel<'info> {
    #[account(mut, seeds = [ARENA_SEED, trainer.owner.as_ref()], bump = arena.bump)]
    pub arena: Account<'info, Arena>,
    #[account(seeds = [TRAINER_SEED, trainer.owner.as_ref()], bump = trainer.bump)]
    pub trainer: Account<'info, Trainer>,
    #[session(signer = signer, authority = trainer.owner.key())]
    pub session_token: Option<Account<'info, SessionTokenV2>>,
    #[account(mut)]
    pub signer: Signer<'info>,
}

#[derive(Accounts, Session)]
pub struct HostArena<'info> {
    #[account(mut, seeds = [ARENA_SEED, arena.host.as_ref()], bump = arena.bump)]
    pub arena: Account<'info, Arena>,
    #[session(signer = signer, authority = arena.host.key())]
    pub session_token: Option<Account<'info, SessionTokenV2>>,
    #[account(mut)]
    pub signer: Signer<'info>,
}

#[derive(Accounts, Session)]
pub struct JoinDuel<'info> {
    #[account(mut, seeds = [ARENA_SEED, arena.host.as_ref()], bump = arena.bump)]
    pub arena: Account<'info, Arena>,
    /// The guest must be onboarded (its Trainer is updated at settlement).
    #[account(seeds = [TRAINER_SEED, guest_trainer.owner.as_ref()], bump = guest_trainer.bump)]
    pub guest_trainer: Account<'info, Trainer>,
    #[session(signer = signer, authority = guest_trainer.owner.key())]
    pub session_token: Option<Account<'info, SessionTokenV2>>,
    #[account(mut)]
    pub signer: Signer<'info>,
    /// CHECK: host species feed
    pub feed_a: UncheckedAccount<'info>,
    /// CHECK: guest species feed
    pub feed_b: UncheckedAccount<'info>,
}

/// A duel action by one seat: `trainer` is that player's Trainer (identity), `signer` the wallet or its session key.
#[derive(Accounts, Session)]
pub struct DuelAction<'info> {
    #[account(mut, seeds = [ARENA_SEED, arena.host.as_ref()], bump = arena.bump)]
    pub arena: Account<'info, Arena>,
    #[account(seeds = [TRAINER_SEED, trainer.owner.as_ref()], bump = trainer.bump)]
    pub trainer: Account<'info, Trainer>,
    #[session(signer = signer, authority = trainer.owner.key())]
    pub session_token: Option<Account<'info, SessionTokenV2>>,
    #[account(mut)]
    pub signer: Signer<'info>,
}

#[derive(Accounts, Session)]
pub struct ArmTimer<'info> {
    #[account(mut, seeds = [ARENA_SEED, arena.host.as_ref()], bump = arena.bump)]
    pub arena: Account<'info, Arena>,
    #[account(seeds = [TRAINER_SEED, trainer.owner.as_ref()], bump = trainer.bump)]
    pub trainer: Account<'info, Trainer>,
    #[session(signer = signer, authority = trainer.owner.key())]
    pub session_token: Option<Account<'info, SessionTokenV2>>,
    #[account(mut)]
    pub signer: Signer<'info>,
    pub magic_program: Program<'info, ephemeral_rollups_sdk::anchor::MagicProgram>,
}

#[derive(Accounts)]
pub struct CrankTimeout<'info> {
    #[account(mut, seeds = [ARENA_SEED, arena.host.as_ref()], bump = arena.bump)]
    pub arena: Account<'info, Arena>,
    /// Only the validator's task scheduler can sign for this PDA.
    #[account(seeds = [CRANK_SEED, arena.key().as_ref()], bump, seeds::program = CRANK_PROGRAM_ID)]
    pub crank_signer: Signer<'info>,
    #[account(mut, seeds = [TRAINER_SEED, arena.host.as_ref()], bump = host_trainer.bump)]
    pub host_trainer: Account<'info, Trainer>,
    #[account(mut, seeds = [TRAINER_SEED, arena.guest.as_ref()], bump = guest_trainer.bump)]
    pub guest_trainer: Account<'info, Trainer>,
}

#[vrf]
#[derive(Accounts, Session)]
pub struct LockPick<'info> {
    #[account(mut, seeds = [ARENA_SEED, arena.host.as_ref()], bump = arena.bump)]
    pub arena: Account<'info, Arena>,
    #[session(signer = signer, authority = arena.host.key())]
    pub session_token: Option<Account<'info, SessionTokenV2>>,
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
#[derive(Accounts, Session)]
pub struct RevealPick<'info> {
    #[account(mut, seeds = [ARENA_SEED, arena.host.as_ref()], bump = arena.bump)]
    pub arena: Account<'info, Arena>,
    #[account(seeds = [TRAINER_SEED, trainer.owner.as_ref()], bump = trainer.bump)]
    pub trainer: Account<'info, Trainer>,
    #[session(signer = signer, authority = trainer.owner.key())]
    pub session_token: Option<Account<'info, SessionTokenV2>>,
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

#[derive(Accounts, Session)]
pub struct Forfeit<'info> {
    #[account(mut, seeds = [ARENA_SEED, arena.host.as_ref()], bump = arena.bump)]
    pub arena: Account<'info, Arena>,
    #[account(mut, seeds = [TRAINER_SEED, arena.host.as_ref()], bump = host_trainer.bump)]
    pub host_trainer: Account<'info, Trainer>,
    #[account(mut, seeds = [TRAINER_SEED, arena.guest.as_ref()], bump = guest_trainer.bump)]
    pub guest_trainer: Account<'info, Trainer>,
    /// The conceding player's Trainer (identity only; also appears above as host or guest).
    #[account(seeds = [TRAINER_SEED, actor.owner.as_ref()], bump = actor.bump)]
    pub actor: Account<'info, Trainer>,
    #[session(signer = signer, authority = actor.owner.key())]
    pub session_token: Option<Account<'info, SessionTokenV2>>,
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
#[derive(Accounts, Session)]
pub struct CommitTrainer<'info> {
    #[account(mut, seeds = [TRAINER_SEED, trainer.owner.as_ref()], bump = trainer.bump)]
    pub trainer: Account<'info, Trainer>,
    #[session(signer = signer, authority = trainer.owner.key())]
    pub session_token: Option<Account<'info, SessionTokenV2>>,
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

/// Base layer. `payer` is anyone (the game's relayer, the player, a judge); the badge always goes to `owner`.
#[derive(Accounts)]
#[instruction(id: u8)]
pub struct MintBadge<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: the badge recipient; bound to the Trainer record below
    pub owner: UncheckedAccount<'info>,
    /// CHECK: the owner's Trainer PDA on the base layer (owned by this program or, while delegated, by the delegation
    /// program); its address proves the data is the real record, and the discriminator is checked on deserialize
    #[account(seeds = [TRAINER_SEED, owner.key().as_ref()], bump)]
    pub trainer: UncheckedAccount<'info>,
    #[account(
        init_if_needed, payer = payer, seeds = [BADGE_MINT_SEED, &[id]], bump,
        mint::decimals = 0, mint::authority = badge_authority
    )]
    pub badge_mint: Account<'info, Mint>,
    /// CHECK: PDA that is the mint authority of every badge mint
    #[account(seeds = [BADGE_AUTH_SEED], bump)]
    pub badge_authority: UncheckedAccount<'info>,
    #[account(init_if_needed, payer = payer, associated_token::mint = badge_mint, associated_token::authority = owner)]
    pub owner_ata: Account<'info, TokenAccount>,
    #[account(init, payer = payer, space = 8 + Claim::INIT_SPACE, seeds = [CLAIM_SEED, owner.key().as_ref(), &[id]], bump)]
    pub claim: Account<'info, Claim>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}
