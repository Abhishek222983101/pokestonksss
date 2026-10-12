import { PublicKey } from "@solana/web3.js";
import { PROGRAM_ID } from "./config";

export const trainerPda = (owner: PublicKey, programId = PROGRAM_ID) =>
  PublicKey.findProgramAddressSync([Buffer.from("trainer"), owner.toBuffer()], programId)[0];
export const arenaPda = (owner: PublicKey, programId = PROGRAM_ID) =>
  PublicKey.findProgramAddressSync([Buffer.from("arena"), owner.toBuffer()], programId)[0];
