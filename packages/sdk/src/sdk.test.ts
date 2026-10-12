import { describe, expect, it } from "vitest";
import { Keypair, PublicKey } from "@solana/web3.js";
import { GameClient, FEEDS, arenaPda, decodeMatch, tierName, Latency, devnetConfig } from "./index";

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
    expect(m.sides[0]).toEqual({ species: 3, hp: 100, maxHp: 120, charged: true, lastGuard: false, momentum: 0 });
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
});
