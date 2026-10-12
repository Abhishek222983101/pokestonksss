import { PublicKey } from "@solana/web3.js";
import { PROGRAM_ID } from "./config";

/** Season 2 seeds (levels, xp, avatar, session keys). */
export const trainerPda = (owner: PublicKey, programId = PROGRAM_ID) =>
  PublicKey.findProgramAddressSync([Buffer.from("trainer2"), owner.toBuffer()], programId)[0];
export const arenaPda = (owner: PublicKey, programId = PROGRAM_ID) =>
  PublicKey.findProgramAddressSync([Buffer.from("arena2"), owner.toBuffer()], programId)[0];

export const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
export const ATA_PROGRAM_ID = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
/** GPL session keys program (MagicBlock). */
export const SESSION_PROGRAM_ID = new PublicKey("KeyspM2ssCJbqUhQ4k7sveSiY4WjnYsrXkC8oDbwde5");

export const badgeMintPda = (id: number, programId = PROGRAM_ID) =>
  PublicKey.findProgramAddressSync([Buffer.from("badge_mint"), Buffer.from([id])], programId)[0];
export const badgeAuthorityPda = (programId = PROGRAM_ID) =>
  PublicKey.findProgramAddressSync([Buffer.from("badge_auth")], programId)[0];
export const claimPda = (owner: PublicKey, id: number, programId = PROGRAM_ID) =>
  PublicKey.findProgramAddressSync([Buffer.from("claim"), owner.toBuffer(), Buffer.from([id])], programId)[0];
export const ataOf = (owner: PublicKey, mint: PublicKey) =>
  PublicKey.findProgramAddressSync([owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()], ATA_PROGRAM_ID)[0];
/** `["session_token_v2", target_program, session_signer, authority]` under the session keys program. */
export const sessionTokenPda = (sessionSigner: PublicKey, authority: PublicKey, targetProgram = PROGRAM_ID) =>
  PublicKey.findProgramAddressSync(
    [Buffer.from("session_token_v2"), targetProgram.toBuffer(), sessionSigner.toBuffer(), authority.toBuffer()],
    SESSION_PROGRAM_ID,
  )[0];
