import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PublicKey } from "@solana/web3.js";

export const IDL_PATH = resolve(__dirname, "../../target/idl/pokestonksss.json");
export const loadGameIdl = () => JSON.parse(readFileSync(IDL_PATH, "utf8"));
export const programIdOf = () => new PublicKey(loadGameIdl().address);

export const trainerPda = (pid: PublicKey, owner: PublicKey) => PublicKey.findProgramAddressSync([Buffer.from("trainer"), owner.toBuffer()], pid)[0];
export const arenaPda = (pid: PublicKey, owner: PublicKey) => PublicKey.findProgramAddressSync([Buffer.from("arena"), owner.toBuffer()], pid)[0];

/** Devnet price feed accounts per BrokerMon species id 0..7 (SOL BTC ETH SUI ZEC BNB DOGE XRP). */
export const FEEDS = [
  "ENYwebBThHzmzwPLAQvCucUTsjyfBSZdD9ViXksS4jPu",
  "71wtTRDY8Gxgw56bXFt2oc6qeAbTxzStdNiC425Z51sr",
  "5vaYr1hpv8yrSpu8w3K95x22byYxUJCCNCSYJtqVWPvG",
  "5WLZBMYdJ9PyNLEVxUumz9XZ11446L6dEPHGkPGehJ2j",
  "6XWQr2Y1XEpJrCdVbYGupnDeb3wkR4YXazVXdgn2Lwpg",
  "BYcDWZKZcGo8y3252xkK9ZrLoRoeMFaixWD6SoeW12fs",
  "Gi5NTTpv9bzBQTgjKyqczJPtSbH1ojebLFgRrP3JKZYZ",
  "6ghNHfjf5YP1aKtpAfdHK1KrtKEm5Ww6SaDffDTxf5xX",
].map((s) => new PublicKey(s));

export const PHASE = { IDLE: 0, WAITING: 1, PICKING: 2, REVEALING: 3, ROLLING: 4, FINISHED: 5 } as const;

/** decode duel_rules::MatchState bytes (16 B): turn, winner, then per side species,hp(2),maxhp(2),charged,last_guard */
export function decodeState(b: number[] | Uint8Array) {
  const u = Buffer.from(b as Uint8Array);
  const side = (i: number) => {
    const o = 2 + i * 7;
    return { species: u[o], hp: u.readUInt16LE(o + 1), maxHp: u.readUInt16LE(o + 3), charged: u[o + 5] === 1, lastGuard: u[o + 6] === 1 };
  };
  return { turn: u[0], winner: u[1], sides: [side(0), side(1)] };
}
