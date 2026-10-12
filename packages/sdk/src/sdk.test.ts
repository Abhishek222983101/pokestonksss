import { describe, expect, it } from "vitest";
import { Keypair, PublicKey } from "@solana/web3.js";
import { GameClient, FEEDS, arenaPda, decodeMatch, tierName, Latency, devnetConfig, levelForXp, levelProgress, evolutionStage, badgesEarned, BADGES, deriveRoll, trainerPda, sessionTokenPda, badgeMintPda, duelPda, spickPda, permissionPda, MAX_LEVEL } from "./index";

const hex = (a: number[]) => a.map((b) => b.toString(16).padStart(2, "0")).join("");

describe("sdk", () => {
  it("commitment matches the Rust known-answer vector", () => {
    const h = GameClient.commitment(1, new Uint8Array(32).fill(7), new PublicKey(new Uint8Array(32).fill(1)), 3, new PublicKey(new Uint8Array(32).fill(2)));
    expect(hex(h)).toBe("ef7f7f129e62d7d4d84eeb28ea89ad29b136d82605edbd9584b5ce521dc186c0");
  });
  it("token hash is sha256", () => {
    expect(hex(GameClient.tokenHash(new Uint8Array(32).fill(0))).length).toBe(64);
  });
  it("decodes MatchState bytes", () => {
    const b = new Uint8Array(16);
    b[0] = 2; b[1] = 255; b[2] = 3; b[3] = 100; b[4] = 0; b[5] = 120; b[6] = 0; b[7] = 1; b[8] = 0; b[9] = 4; b[10] = 50; b[11] = 0; b[12] = 90; b[13] = 0; b[14] = 0; b[15] = 1;
    const m = decodeMatch(b);
    expect(m.turn).toBe(2);
    expect(m.sides[0]).toEqual({ species: 3, hp: 100, maxHp: 120, charged: true, lastGuard: false, momentum: 0, level: 0 });
    expect(m.sides[1].lastGuard).toBe(true);
  });
  it("pdas are deterministic and feeds cover 8 species", () => {
    const k = Keypair.generate().publicKey;
    expect(arenaPda(k).equals(arenaPda(k))).toBe(true);
    expect(FEEDS.length).toBe(8);
  });
  it("tier names and latency stats", () => {
    expect(tierName(800)).toBe("Shrimp");
    expect(tierName(1500)).toBe("Whale");
    const l = new Latency();
    [10, 20, 30, 40, 100].forEach((x) => l.add(x));
    expect(l.p50).toBe(30);
    expect(l.p95).toBe(100);
  });
  it("devnet config defaults to Asia", () => {
    expect(devnetConfig().erHttp).toContain("devnet-as");
  });
  it("decodes the level packed next to momentum and last_guard", () => {
    const b = new Uint8Array(16);
    b[1] = 255;
    b[2] = 1; b[3] = 150; b[5] = 160; b[8] = 0; b[8] = 0;
    b[8] = (1 << 1) | (5 << 3); // momentum 1, level 5, last_guard 0 (side 0 flags byte is index 2 + 6)
    const m = decodeMatch(b);
    expect(m.sides[0].momentum).toBe(1);
    expect(m.sides[0].level).toBe(5);
  });
  it("xp to level table mirrors the Rust rules", () => {
    expect(levelForXp(0)).toBe(0);
    expect(levelForXp(29)).toBe(0);
    expect(levelForXp(30)).toBe(1);
    expect(levelForXp(119)).toBe(2);
    expect(levelForXp(120)).toBe(3);
    expect(levelForXp(630)).toBe(MAX_LEVEL);
    expect(levelForXp(60000)).toBe(MAX_LEVEL);
    expect(evolutionStage(2)).toBe(0);
    expect(evolutionStage(3)).toBe(1);
    expect(evolutionStage(6)).toBe(2);
    expect(levelProgress(75).level).toBe(2);
    expect(levelProgress(630).toNext).toBeNull();
  });
  it("badge rules mirror the program", () => {
    const base = { wins: 0, dex: 0, rating: 1000, streak: 0, xp: [0, 0, 0, 0, 0, 0, 0, 0] };
    expect(badgesEarned(base).some(Boolean)).toBe(false);
    expect(badgesEarned({ ...base, wins: 1 })[0]).toBe(true);
    expect(badgesEarned({ ...base, wins: 5 })[1]).toBe(true);
    expect(badgesEarned({ ...base, dex: 0b1111 })[2]).toBe(true);
    expect(badgesEarned({ ...base, rating: 1200 }).slice(3, 5)).toEqual([true, true]);
    expect(badgesEarned({ ...base, xp: [0, 0, 120, 0, 0, 0, 0, 0] })[5]).toBe(true);
    expect(badgesEarned({ ...base, xp: [0, 0, 330, 0, 0, 0, 0, 0] })[6]).toBe(true);
    expect(badgesEarned({ ...base, streak: 3 })[7]).toBe(true);
    expect(BADGES.length).toBe(16);
    expect(badgesEarned({ ...base, dex: 0b1000 }).slice(8).map(Boolean)).toEqual([false, false, false, true, false, false, false, false]);
  });
  it("season 2 pdas are distinct per owner and purpose", () => {
    const a = Keypair.generate().publicKey, b = Keypair.generate().publicKey;
    expect(trainerPda(a).equals(trainerPda(b))).toBe(false);
    expect(trainerPda(a).equals(arenaPda(a))).toBe(false);
    expect(sessionTokenPda(a, b).equals(sessionTokenPda(b, a))).toBe(false);
    expect(badgeMintPda(0).equals(badgeMintPda(1))).toBe(false);
    const d = duelPda(a);
    expect(spickPda(d, a).equals(spickPda(d, b))).toBe(false);
    expect(permissionPda(spickPda(d, a)).equals(permissionPda(spickPda(d, b)))).toBe(false);
  });
  it("sealed roll known answer matches the Rust program", () => {
    const h = deriveRoll(new Uint8Array(32).fill(7), 1, [0, 2], [11n, 22n]);
    expect(hex(Array.from(h))).toBe("86d31b53dfc87d73c5798b043969ec0926b41c717e626827fec05957b052a3bd");
  });
});
