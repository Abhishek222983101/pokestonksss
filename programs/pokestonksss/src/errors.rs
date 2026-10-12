use anchor_lang::prelude::*;

#[error_code]
pub enum GameError {
    #[msg("not a player in this arena")]
    NotAPlayer,
    #[msg("arena is not in the right phase for this action")]
    WrongPhase,
    #[msg("invalid species or slot")]
    BadInput,
    #[msg("arena state is corrupt")]
    CorruptState,
    #[msg("a roll is already pending")]
    RollPending,
    #[msg("join token does not match")]
    BadToken,
    #[msg("duel invite expired")]
    InviteExpired,
    #[msg("reveal does not match the commitment")]
    BadReveal,
    #[msg("deadline has not passed")]
    NotYetDue,
    #[msg("arena cannot be reset yet")]
    CannotReset,
    #[msg("cannot duel yourself")]
    SelfDuel,
}
