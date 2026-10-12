//! Sealed duels on a MagicBlock **Private Ephemeral Rollup** (Intel TDX TEE).
//!
//! Two players duel with picks that nobody can read, not even the opponent, until the turn resolves:
//!   * each player has a `SealedPick` account whose `EphemeralPermission` lists only that player's match key
//!     (members are derived on chain, never taken from the caller);
//!   * `s_lock` writes the pick and a secret nonce into the player's own private account;
//!   * `s_resolve` (anyone) reads both private picks inside the TEE, mixes the base-layer VRF seed with both sealed
//!     nonces into the roll, runs the same Rust rules as every other mode, and publishes the turn log;
//!   * `s_finish` commits the finished duel back to Solana and undelegates it.
//! Identity inside the match is a throwaway per-match key, so nothing links a private duel to a wallet.
use anchor_lang::prelude::*;
use anchor_lang::system_program::{transfer, Transfer};
use duel_rules::{resolve_turn, MatchState, NO_WINNER};
use ephemeral_rollups_sdk::access_control::instructions::CreateEphemeralPermissionCpi;
use ephemeral_rollups_sdk::access_control::structs::{
    EphemeralMembersArgs, EphemeralPermission, Member, PERMISSION_SEED, TX_BALANCES_FLAG, TX_LOGS_FLAG, TX_MESSAGE_FLAG,
};
use ephemeral_rollups_sdk::anchor::{commit, delegate, vrf, vrf_callback};
use ephemeral_rollups_sdk::consts::{EPHEMERAL_VAULT_ID, MAGIC_PROGRAM_ID, PERMISSION_PROGRAM_ID};
use ephemeral_rollups_sdk::cpi::DelegateConfig;
use ephemeral_rollups_sdk::ephem::{FoldableIntentBuilder, MagicIntentBundleBuilder};
use ephemeral_rollups_sdk::vrf::{
    self,
    instructions::{create_request_scoped_randomness_ix, RequestRandomnessParams},
    types::SerializableAccountMeta,
};
use solana_sha256_hasher::hashv;

use crate::consts::MAX_SPECIES;
use crate::errors::GameError;

pub const DUEL_SEED: &[u8] = b"sduel";
pub const SPICK_SEED: &[u8] = b"spick";

pub const S_OPEN: u8 = 0; // created, waiting for the guest (base layer)
pub const S_JOINED: u8 = 1; // guest joined (base layer)
pub const S_SEEDED: u8 = 2; // VRF seed written (base layer)
pub const S_LIVE: u8 = 3; // delegated to the TEE, permissions in place, picks accepted
pub const S_FINISHED: u8 = 4;

pub const S_TURNS: usize = 16;
/// Seconds a player has to lock after the other one did (or to start at all) before the duel can be timed out.
pub const S_TURN_TIMEOUT_SECS: i64 = 40;
pub const S_JOIN_WINDOW_SECS: i64 = 900;

/// One resolved turn, public once resolved: the picks, the sealed nonces that fed the roll, and the roll bytes.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Default, Debug, PartialEq, Eq, InitSpace)]
pub struct SealedTurn {
    pub picks: [u8; 2],
    pub nonces: [u64; 2],
    pub rnd: [u8; duel_rules::RND_USED],
}

#[account]
#[derive(InitSpace)]
pub struct SealedDuel {
    pub status: u8,
    pub bump: u8,
    /// Per-match keys: the only signers inside the TEE and the only members of their own pick's permission.
    pub players: [Pubkey; 2],
    pub token_hash: [u8; 32],
    pub species: [u8; 2],
    /// duel_rules::MatchState bytes (public: hp and flags are not secret).
    pub state: [u8; duel_rules::STATE_BYTES],
    /// Public "who is ready" bits. Carries no secret.
    pub locked_mask: u8,
    pub lock_slot: u64,
    pub lock_ts: i64,
    pub progress_ts: i64,
    /// MagicBlock VRF output, written on the base layer before delegation (public by design).
    pub seed: [u8; 32],
    pub winner: u8,
    pub log_len: u8,
    pub log: [SealedTurn; S_TURNS],
}

#[account]
#[derive(InitSpace)]
pub struct SealedPick {
    pub duel: Pubkey,
    pub player: Pubkey,
    pub bump: u8,
    pub turn: u8,
    pub locked: bool,
    pub slot: u8,
    pub nonce: u64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub enum SealedAccount {
    Duel { host: Pubkey },
    Pick { duel: Pubkey, player: Pubkey },
}

/// roll = sha256(domain ‖ seed ‖ turn ‖ picks ‖ nonceA ‖ nonceB). The seed is public, each nonce is sealed until the
/// turn resolves, so neither player can predict or grind the roll. The log publishes picks and nonces afterwards.
pub fn derive_roll(seed: &[u8; 32], turn: u8, picks: [u8; 2], nonces: [u64; 2]) -> [u8; 32] {
    hashv(&[
        b"pokestonksss/sealed-roll".as_slice(),
        seed.as_slice(),
        [turn].as_slice(),
        picks.as_slice(),
        nonces[0].to_le_bytes().as_slice(),
        nonces[1].to_le_bytes().as_slice(),
    ])
    .to_bytes()
}

pub fn permission_rent(members: usize) -> u64 {
    ephemeral_rollups_sdk::ephemeral_accounts::rent(EphemeralPermission::size_of(members) as u32)
}

fn fund<'info>(sys: &Program<'info, System>, from: &Signer<'info>, to: AccountInfo<'info>, lamports: u64) -> Result<()> {
    transfer(CpiContext::new(sys.key(), Transfer { from: from.to_account_info(), to }), lamports)
}

/// Read access to the pick only: the TEE enforces that, we only add flags for the member's own tx visibility.
fn view_member(pubkey: Pubkey) -> Member {
    Member { flags: TX_LOGS_FLAG | TX_MESSAGE_FLAG | TX_BALANCES_FLAG, pubkey }
}

fn seeds_for(t: &SealedAccount) -> Vec<Vec<u8>> {
    match t {
        SealedAccount::Duel { host } => vec![DUEL_SEED.to_vec(), host.to_bytes().to_vec()],
        SealedAccount::Pick { duel, player } => vec![SPICK_SEED.to_vec(), duel.to_bytes().to_vec(), player.to_bytes().to_vec()],
    }
}

impl SealedDuel {
    pub fn index_of(&self, p: &Pubkey) -> Result<usize> {
        if *p == self.players[0] {
            Ok(0)
        } else if *p == self.players[1] {
            Ok(1)
        } else {
            err!(GameError::NotAPlayer)
        }
    }
}

// ================================================================================== instruction bodies

pub fn create(ctx: Context<SCreate>, host: Pubkey, species: u8, token_hash: [u8; 32]) -> Result<()> {
    require!(species < MAX_SPECIES, GameError::BadInput);
    // the delegated pick pays its own permission rent on the rollup: pre-fund it
    fund(&ctx.accounts.system_program, &ctx.accounts.payer, ctx.accounts.pick.to_account_info(), permission_rent(1))?;
    let now = Clock::get()?.unix_timestamp;
    let d = &mut ctx.accounts.duel;
    d.status = S_OPEN;
    d.bump = ctx.bumps.duel;
    d.players = [host, Pubkey::default()];
    d.token_hash = token_hash;
    d.species = [species, 0];
    d.state = MatchState::new(species, species).ok_or(GameError::BadInput)?.to_bytes();
    d.winner = NO_WINNER;
    d.lock_ts = now;
    d.progress_ts = now;
    let p = &mut ctx.accounts.pick;
    p.duel = d.key();
    p.player = host;
    p.bump = ctx.bumps.pick;
    Ok(())
}

pub fn join(ctx: Context<SJoin>, guest: Pubkey, species: u8, token: [u8; 32]) -> Result<()> {
    require!(species < MAX_SPECIES, GameError::BadInput);
    let now = Clock::get()?.unix_timestamp;
    let d = &mut ctx.accounts.duel;
    require!(d.status == S_OPEN, GameError::WrongPhase);
    require!(now <= d.progress_ts + S_JOIN_WINDOW_SECS, GameError::InviteExpired);
    require!(hashv(&[&token]).to_bytes() == d.token_hash, GameError::BadToken);
    require!(guest != d.players[0], GameError::SelfDuel);
    fund(&ctx.accounts.system_program, &ctx.accounts.payer, ctx.accounts.pick.to_account_info(), permission_rent(1))?;
    d.players[1] = guest;
    d.species[1] = species;
    d.state = MatchState::new(d.species[0], species).ok_or(GameError::BadInput)?.to_bytes();
    d.status = S_JOINED;
    d.progress_ts = now;
    let p = &mut ctx.accounts.pick;
    p.duel = d.key();
    p.player = guest;
    p.bump = ctx.bumps.pick;
    Ok(())
}

/// Base layer: asks MagicBlock VRF for the duel seed. Must run before delegation (the callback writes the duel).
pub fn request_seed(ctx: Context<SRequestSeed>) -> Result<()> {
    require!(ctx.accounts.duel.status == S_JOINED, GameError::WrongPhase);
    require!(ctx.accounts.duel.index_of(&ctx.accounts.payer.key()).is_ok(), GameError::NotAPlayer);
    let ix = create_request_scoped_randomness_ix(RequestRandomnessParams {
        payer: ctx.accounts.payer.key(),
        oracle_queue: ctx.accounts.oracle_queue.key(),
        callback_program_id: crate::ID,
        callback_discriminator: crate::instruction::SConsumeSeed::DISCRIMINATOR.to_vec(),
        caller_seed: hashv(&[b"pokestonksss/sealed-seed".as_slice(), ctx.accounts.duel.key().as_ref()]).to_bytes(),
        accounts_metas: Some(vec![SerializableAccountMeta { pubkey: ctx.accounts.duel.key(), is_signer: false, is_writable: true }]),
        ..Default::default()
    });
    ctx.accounts.invoke_signed_vrf(&ctx.accounts.payer.to_account_info(), &ix)?;
    Ok(())
}

/// Base layer VRF callback (identity enforced by `#[vrf_callback]`). Idempotent: only the first callback counts.
pub fn consume_seed(ctx: Context<SConsumeSeed>, randomness: [u8; 32]) -> Result<()> {
    let d = &mut ctx.accounts.duel;
    require!(d.status == S_JOINED, GameError::WrongPhase);
    d.seed = randomness;
    d.status = S_SEEDED;
    Ok(())
}

/// Base layer: delegate the duel or a pick to the TEE validator (passed as the optional `validator` account).
/// Nobody can delegate before the guest joined and the VRF seed landed.
pub fn delegate_one(ctx: Context<SDelegate>, account: SealedAccount) -> Result<()> {
    {
        let data = ctx.accounts.duel_view.try_borrow_data()?;
        let d = SealedDuel::try_deserialize(&mut &data[..])?;
        require!(d.status == S_SEEDED, GameError::WrongPhase);
        require!(d.index_of(&ctx.accounts.payer.key()).is_ok(), GameError::NotAPlayer);
        match &account {
            SealedAccount::Duel { host } => require!(*host == d.players[0], GameError::NotAPlayer),
            SealedAccount::Pick { duel, player } => {
                require_keys_eq!(*duel, ctx.accounts.duel_view.key(), GameError::NotAPlayer);
                require!(d.index_of(player).is_ok(), GameError::NotAPlayer);
            }
        }
    }
    let seed_data = seeds_for(&account);
    let seed_refs: Vec<&[u8]> = seed_data.iter().map(|s| s.as_slice()).collect();
    ctx.accounts.delegate_pda(
        &ctx.accounts.payer,
        &seed_refs,
        DelegateConfig { validator: ctx.accounts.validator.as_ref().map(|v| v.key()), ..Default::default() },
    )?;
    Ok(())
}

/// TEE: creates both picks' EphemeralPermissions (members derived from the account itself) and flips the duel LIVE.
pub fn open(ctx: Context<SOpen>) -> Result<()> {
    let key = ctx.accounts.duel.key();
    require!(ctx.accounts.duel.status == S_SEEDED, GameError::WrongPhase);
    let players = ctx.accounts.duel.players;
    require!(players.contains(&ctx.accounts.payer.key()), GameError::NotAPlayer);
    for (i, (pick, perm)) in [
        (ctx.accounts.pick_a.to_account_info(), ctx.accounts.permission_a.to_account_info()),
        (ctx.accounts.pick_b.to_account_info(), ctx.accounts.permission_b.to_account_info()),
    ]
    .into_iter()
    .enumerate()
    {
        let (member, bump) = {
            let p = SealedPick::try_deserialize(&mut &pick.try_borrow_data()?[..])?;
            require!(p.duel == key && p.player == players[i], GameError::NotAPlayer);
            (p.player, p.bump)
        };
        if perm.lamports() > 0 {
            continue; // idempotent
        }
        let seeds_vec: Vec<Vec<u8>> = vec![SPICK_SEED.to_vec(), key.to_bytes().to_vec(), member.to_bytes().to_vec(), vec![bump]];
        let seed_refs: Vec<&[u8]> = seeds_vec.iter().map(|s| s.as_slice()).collect();
        CreateEphemeralPermissionCpi {
            payer: pick.clone(), // the delegated pick pays its own permission rent
            permissioned_account: pick.clone(),
            permission: perm,
            vault: ctx.accounts.ephemeral_vault.to_account_info(),
            magic_program: ctx.accounts.magic_program.to_account_info(),
            permission_program: ctx.accounts.permission_program.to_account_info(),
            // ONLY the owner can read the pick (the program itself can always read it inside the TEE)
            args: EphemeralMembersArgs { is_private: true, members: vec![view_member(member)] },
        }
        .invoke_signed(&[seed_refs.as_slice()])?;
    }
    let now = Clock::get()?.unix_timestamp;
    let d = &mut ctx.accounts.duel;
    d.status = S_LIVE;
    d.progress_ts = now;
    d.lock_ts = now;
    Ok(())
}

/// TEE: seal a pick. The slot and the secret nonce are written ONLY into the player's own private pick account and
/// are never logged. Refuses to run unless the pick's permission exists, is private and lists exactly this player.
pub fn lock(ctx: Context<SLock>, slot: u8, nonce: u64) -> Result<()> {
    let now = Clock::get()?;
    let d = &mut ctx.accounts.duel;
    require!(d.status == S_LIVE, GameError::WrongPhase);
    require!(slot < 4, GameError::BadInput);
    let idx = d.index_of(&ctx.accounts.player.key())?;
    require!(d.locked_mask & (1 << idx) == 0, GameError::WrongPhase);
    {
        let pd = ctx.accounts.permission.try_borrow_data()?;
        let perm = EphemeralPermission::from_bytes(&pd).map_err(|_| error!(GameError::PermissionMissing))?;
        let me = ctx.accounts.player.key().to_bytes();
        let opp = d.players[1 - idx].to_bytes();
        require!(perm.private, GameError::PermissionNotPrivate);
        require!(perm.members.iter().any(|m| m.pubkey.to_bytes() == me), GameError::PermissionNotPrivate);
        require!(!perm.members.iter().any(|m| m.pubkey.to_bytes() == opp), GameError::PermissionNotPrivate);
    }
    let p = &mut ctx.accounts.pick;
    p.slot = slot;
    p.nonce = nonce;
    p.locked = true;
    p.turn = d.state[0];
    d.locked_mask |= 1 << idx;
    d.lock_slot = now.slot;
    d.lock_ts = now.unix_timestamp;
    d.progress_ts = now.unix_timestamp;
    Ok(())
}

/// TEE: anyone can resolve once both picks are locked. `slot > lock_slot` blocks the "simulate [lock(X), resolve] in one
/// transaction and read the outcome" probe by whoever locks second.
pub fn resolve(ctx: Context<SResolve>) -> Result<()> {
    let clock = Clock::get()?;
    let d = &mut ctx.accounts.duel;
    require!(d.status == S_LIVE, GameError::WrongPhase);
    require!(d.locked_mask == 0b11, GameError::NotYetDue);
    require!(clock.slot > d.lock_slot, GameError::NotYetDue);
    let (a, b) = (&mut ctx.accounts.pick_a, &mut ctx.accounts.pick_b);
    let turn = d.state[0];
    require!(a.locked && b.locked && a.turn == turn && b.turn == turn, GameError::NotYetDue);

    let picks = [a.slot, b.slot];
    let nonces = [a.nonce, b.nonce];
    let roll = derive_roll(&d.seed, turn, picks, nonces);
    let mut st = MatchState::from_bytes(&d.state).ok_or(GameError::CorruptState)?;
    let _events = resolve_turn(&mut st, picks, &roll, [0, 0]);
    d.state = st.to_bytes();
    let at = d.log_len as usize;
    if at < S_TURNS {
        let mut rnd = [0u8; duel_rules::RND_USED];
        rnd.copy_from_slice(&roll[..duel_rules::RND_USED]);
        d.log[at] = SealedTurn { picks, nonces, rnd };
        d.log_len += 1;
    }
    d.locked_mask = 0;
    d.progress_ts = clock.unix_timestamp;
    if st.is_over() {
        d.winner = st.winner;
        d.status = S_FINISHED;
    }
    // wipe the sealed material: it is public in the log now
    for p in [a, b] {
        p.locked = false;
        p.slot = 0;
        p.nonce = 0;
    }
    Ok(())
}

/// TEE: permissionless. One side never locked: the side that did wins. Nobody did: closed without a result.
pub fn timeout(ctx: Context<STimeout>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let d = &mut ctx.accounts.duel;
    require!(d.status == S_LIVE, GameError::WrongPhase);
    match d.locked_mask {
        0b01 | 0b10 => {
            require!(now >= d.lock_ts + S_TURN_TIMEOUT_SECS, GameError::NotYetDue);
            d.winner = if d.locked_mask == 0b01 { 0 } else { 1 };
        }
        0 => {
            require!(now >= d.progress_ts + 2 * S_TURN_TIMEOUT_SECS, GameError::NotYetDue);
            d.winner = NO_WINNER;
        }
        _ => return err!(GameError::WrongPhase), // both locked: just resolve
    }
    d.status = S_FINISHED;
    Ok(())
}

/// TEE: commit the finished duel and both (wiped) picks to Solana and undelegate them.
pub fn finish(ctx: Context<SFinish>) -> Result<()> {
    require!(ctx.accounts.duel.status == S_FINISHED, GameError::WrongPhase);
    require!(ctx.accounts.duel.index_of(&ctx.accounts.payer.key()).is_ok(), GameError::NotAPlayer);
    MagicIntentBundleBuilder::new(
        ctx.accounts.payer.to_account_info(),
        ctx.accounts.magic_context.to_account_info(),
        ctx.accounts.magic_program.to_account_info(),
    )
    .commit_and_undelegate(&[
        ctx.accounts.duel.to_account_info(),
        ctx.accounts.pick_a.to_account_info(),
        ctx.accounts.pick_b.to_account_info(),
    ])
    .build_and_invoke()?;
    Ok(())
}

/// Base layer: the host takes back an invite nobody joined (closes the accounts, refunds rent).
pub fn cancel(ctx: Context<SCancel>) -> Result<()> {
    require!(ctx.accounts.duel.status == S_OPEN, GameError::WrongPhase);
    Ok(())
}

// ================================================================================== contexts

#[derive(Accounts)]
#[instruction(host: Pubkey)]
pub struct SCreate<'info> {
    #[account(init, payer = payer, space = 8 + SealedDuel::INIT_SPACE, seeds = [DUEL_SEED, host.as_ref()], bump)]
    pub duel: Box<Account<'info, SealedDuel>>,
    #[account(init, payer = payer, space = 8 + SealedPick::INIT_SPACE, seeds = [SPICK_SEED, duel.key().as_ref(), host.as_ref()], bump)]
    pub pick: Box<Account<'info, SealedPick>>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(guest: Pubkey)]
pub struct SJoin<'info> {
    #[account(mut, seeds = [DUEL_SEED, duel.players[0].as_ref()], bump = duel.bump)]
    pub duel: Box<Account<'info, SealedDuel>>,
    #[account(init, payer = payer, space = 8 + SealedPick::INIT_SPACE, seeds = [SPICK_SEED, duel.key().as_ref(), guest.as_ref()], bump)]
    pub pick: Box<Account<'info, SealedPick>>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[vrf]
#[derive(Accounts)]
pub struct SRequestSeed<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(seeds = [DUEL_SEED, duel.players[0].as_ref()], bump = duel.bump)]
    pub duel: Box<Account<'info, SealedDuel>>,
    /// CHECK: the base-layer VRF queue (the rollup queue is not served by an oracle inside the TEE)
    #[account(mut, address = vrf::consts::DEFAULT_QUEUE)]
    pub oracle_queue: UncheckedAccount<'info>,
}

#[vrf_callback]
#[derive(Accounts)]
pub struct SConsumeSeed<'info> {
    #[account(mut, seeds = [DUEL_SEED, duel.players[0].as_ref()], bump = duel.bump)]
    pub duel: Box<Account<'info, SealedDuel>>,
}

#[delegate]
#[derive(Accounts)]
pub struct SDelegate<'info> {
    /// CHECK: the duel or pick being delegated (seeds are validated by the delegation CPI)
    #[account(mut, del)]
    pub pda: UncheckedAccount<'info>,
    /// CHECK: the duel, read by hand for the pre-delegation guards
    pub duel_view: UncheckedAccount<'info>,
    pub payer: Signer<'info>,
    /// CHECK: checked by the delegation program (the TEE validator identity)
    pub validator: Option<UncheckedAccount<'info>>,
}

#[derive(Accounts)]
pub struct SOpen<'info> {
    #[account(mut, seeds = [DUEL_SEED, duel.players[0].as_ref()], bump = duel.bump)]
    pub duel: Box<Account<'info, SealedDuel>>,
    /// CHECK: delegated pick of player 0, deserialized by hand
    #[account(mut)]
    pub pick_a: UncheckedAccount<'info>,
    /// CHECK: verified by the permission program
    #[account(mut, seeds = [PERMISSION_SEED, pick_a.key().as_ref()], bump, seeds::program = PERMISSION_PROGRAM_ID)]
    pub permission_a: UncheckedAccount<'info>,
    /// CHECK: delegated pick of player 1, deserialized by hand
    #[account(mut)]
    pub pick_b: UncheckedAccount<'info>,
    /// CHECK: verified by the permission program
    #[account(mut, seeds = [PERMISSION_SEED, pick_b.key().as_ref()], bump, seeds::program = PERMISSION_PROGRAM_ID)]
    pub permission_b: UncheckedAccount<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: Permission Program
    #[account(address = PERMISSION_PROGRAM_ID)]
    pub permission_program: UncheckedAccount<'info>,
    /// CHECK: verified by the magic program
    #[account(mut, address = EPHEMERAL_VAULT_ID)]
    pub ephemeral_vault: UncheckedAccount<'info>,
    /// CHECK: Magic Program
    #[account(address = MAGIC_PROGRAM_ID)]
    pub magic_program: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct SLock<'info> {
    #[account(mut, seeds = [DUEL_SEED, duel.players[0].as_ref()], bump = duel.bump)]
    pub duel: Box<Account<'info, SealedDuel>>,
    #[account(mut, seeds = [SPICK_SEED, duel.key().as_ref(), player.key().as_ref()], bump = pick.bump)]
    pub pick: Box<Account<'info, SealedPick>>,
    /// CHECK: the pick's EphemeralPermission PDA, parsed in the handler
    #[account(seeds = [PERMISSION_SEED, pick.key().as_ref()], bump, seeds::program = PERMISSION_PROGRAM_ID)]
    pub permission: UncheckedAccount<'info>,
    pub player: Signer<'info>,
}

#[derive(Accounts)]
pub struct SResolve<'info> {
    #[account(mut, seeds = [DUEL_SEED, duel.players[0].as_ref()], bump = duel.bump)]
    pub duel: Box<Account<'info, SealedDuel>>,
    #[account(mut, seeds = [SPICK_SEED, duel.key().as_ref(), duel.players[0].as_ref()], bump = pick_a.bump)]
    pub pick_a: Box<Account<'info, SealedPick>>,
    #[account(mut, seeds = [SPICK_SEED, duel.key().as_ref(), duel.players[1].as_ref()], bump = pick_b.bump)]
    pub pick_b: Box<Account<'info, SealedPick>>,
    /// Anyone can crank the resolve.
    pub payer: Signer<'info>,
}

#[derive(Accounts)]
pub struct STimeout<'info> {
    #[account(mut, seeds = [DUEL_SEED, duel.players[0].as_ref()], bump = duel.bump)]
    pub duel: Box<Account<'info, SealedDuel>>,
    pub payer: Signer<'info>,
}

#[commit]
#[derive(Accounts)]
pub struct SFinish<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, seeds = [DUEL_SEED, duel.players[0].as_ref()], bump = duel.bump)]
    pub duel: Box<Account<'info, SealedDuel>>,
    #[account(mut, seeds = [SPICK_SEED, duel.key().as_ref(), duel.players[0].as_ref()], bump = pick_a.bump)]
    pub pick_a: Box<Account<'info, SealedPick>>,
    #[account(mut, seeds = [SPICK_SEED, duel.key().as_ref(), duel.players[1].as_ref()], bump = pick_b.bump)]
    pub pick_b: Box<Account<'info, SealedPick>>,
}

#[derive(Accounts)]
pub struct SCancel<'info> {
    #[account(mut, close = payer, seeds = [DUEL_SEED, duel.players[0].as_ref()], bump = duel.bump, constraint = duel.players[0] == payer.key() @ GameError::NotAPlayer)]
    pub duel: Box<Account<'info, SealedDuel>>,
    #[account(mut, close = payer, seeds = [SPICK_SEED, duel.key().as_ref(), payer.key().as_ref()], bump = pick.bump)]
    pub pick: Box<Account<'info, SealedPick>>,
    #[account(mut)]
    pub payer: Signer<'info>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roll_is_deterministic_and_binds_every_input() {
        let seed = [7u8; 32];
        let base = derive_roll(&seed, 1, [0, 2], [11, 22]);
        assert_eq!(base, derive_roll(&seed, 1, [0, 2], [11, 22]));
        assert_ne!(base, derive_roll(&[8u8; 32], 1, [0, 2], [11, 22]));
        assert_ne!(base, derive_roll(&seed, 2, [0, 2], [11, 22]));
        assert_ne!(base, derive_roll(&seed, 1, [1, 2], [11, 22]));
        assert_ne!(base, derive_roll(&seed, 1, [0, 2], [11, 23]));
        assert_ne!(base, derive_roll(&seed, 1, [0, 2], [12, 22]));
    }

    #[test]
    fn roll_known_answer_matches_the_sdk() {
        let h = derive_roll(&[7u8; 32], 1, [0, 2], [11, 22]);
        let hex: String = h.iter().map(|b| format!("{:02x}", b)).collect();
        // pinned: packages/sdk/src/sealed.ts asserts the same vector with @noble/hashes
        assert_eq!(hex, "86d31b53dfc87d73c5798b043969ec0926b41c717e626827fec05957b052a3bd");
    }

    #[test]
    fn permission_rent_matches_the_live_logs() {
        // live TEE logs: "Created ephemeral: 68 bytes, 4096 rent" (0 members) / "134 bytes, 6208 rent" (2 members)
        assert_eq!(EphemeralPermission::size_of(0), 68);
        assert_eq!(permission_rent(0), 4096);
        assert_eq!(permission_rent(2), 6208);
        assert_eq!(permission_rent(1), 5152);
    }

    #[test]
    fn sizes_fit() {
        assert!(8 + SealedDuel::INIT_SPACE <= 700, "duel {} B", 8 + SealedDuel::INIT_SPACE);
        assert_eq!(SealedPick::INIT_SPACE, 32 + 32 + 1 + 1 + 1 + 1 + 8);
    }
}
