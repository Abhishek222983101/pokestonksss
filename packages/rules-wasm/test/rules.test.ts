import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import * as R from '../src/index';

const here = dirname(fileURLToPath(import.meta.url));
const fx = (n: string) => JSON.parse(readFileSync(resolve(here, '../../../rules/fixtures', n), 'utf8'));

beforeAll(async () => {
  await R.init(readFileSync(resolve(here, '../pkg/duel_wasm_bg.wasm')));
});

describe('turns.json', () => {
  const cases = fx('turns.json') as any[];
  it('has >= 500 cases', () => expect(cases.length).toBeGreaterThanOrEqual(500));
  it('WASM resolveTurn equals every fixture exactly', () => {
    for (const c of cases) {
      const out = R.resolveTurn(c.state, c.picks, R.hexToBytes(c.rnd), c.mood);
      expect(out.state, `case ${c.id} state`).toEqual(c.expect.state);
      expect(out.events, `case ${c.id} events`).toEqual(c.expect.events);
    }
  });
  it('pads short (10-byte) rnd identically', () => {
    for (const c of cases.slice(0, 100)) {
      const full = R.hexToBytes(c.rnd);
      const a = R.resolveTurn(c.state, c.picks, full, c.mood);
      const b = R.resolveTurn(c.state, c.picks, full.slice(0, 10), c.mood);
      expect(b).toEqual(a);
    }
  });
});

describe('bots.json', () => {
  const cases = fx('bots.json') as any[];
  it('has >= 200 cases', () => expect(cases.length).toBeGreaterThanOrEqual(200));
  it('WASM botPick equals every fixture', () => {
    for (const c of cases) expect(R.botPick(c.state, c.side, R.hexToBytes(c.rnd), c.tier), `case ${c.id}`).toBe(c.pick);
  });
});

describe('replays.json', () => {
  const cases = fx('replays.json') as any[];
  it('WASM replay equals every fixture (valid, unfinished, trailing)', () => {
    let n = 0;
    for (const c of cases) {
      for (const v of c.variants) {
        expect(R.replayBytes(c.species, R.hexToBytes(v.log), c.levels), `case ${c.id}`).toEqual(v.expect);
        n++;
      }
    }
    expect(n).toBeGreaterThan(80);
  });
  it('object-form replay matches packed form and tracks a live match', () => {
    const c = cases[1];
    const bytes = R.hexToBytes(c.variants[0].log);
    const log: R.TurnLog[] = [];
    for (let i = 0; i < bytes.length; i += 14)
      log.push({ picks: [bytes[i], bytes[i + 1]], rnd: bytes.slice(i + 2, i + 12), mood: [(bytes[i + 12] << 24) >> 24, (bytes[i + 13] << 24) >> 24] });
    const r = R.replay(c.species, log);
    expect(r).toEqual(c.variants[0].expect);
    // stepping the same log with resolveTurn reaches the same final hp
    let s = R.newMatch(c.species[0], c.species[1]);
    for (const t of log) s = R.resolveTurn(s, t.picks, t.rnd, t.mood).state;
    expect(r.ok && [s.f[0].hp, s.f[1].hp]).toEqual(r.ok && r.hp);
  });
  it('tampered log changes or fails the verdict', () => {
    const c = cases[2];
    const bytes = R.hexToBytes(c.variants[0].log);
    bytes[0] = (bytes[0] + 1) & 3;
    bytes[2] ^= 0xff;
    expect(R.replayBytes(c.species, bytes)).not.toEqual(c.variants[0].expect);
  });
});

describe('wrapper API', () => {
  it('roster matches generated data', () => {
    const r = R.roster();
    expect(r).toEqual(JSON.parse(JSON.stringify(R.ROSTER_DATA)));
    expect(r.champions).toHaveLength(8);
    expect(r.champions.map((c) => c.asset)).toEqual(['SOL', 'BTC', 'ETH', 'SUI', 'ZEC', 'BNB', 'DOGE', 'XRP']);
    expect(r.champions.map((c) => c.feed)).toEqual([6, 1, 2, 11, 66, 15, 13, 14]);
  });
  it('newMatch + preview + elo', () => {
    const s = R.newMatch(0, 1);
    expect(s.turn).toBe(0);
    expect(s.winner).toBeNull();
    const p = R.previewDamage(s, 0, 0)!;
    expect(p.max).toBeGreaterThan(p.min);
    expect(R.previewDamage(s, 0, 2)).toBeNull();
    expect(R.eloUpdate(1000, 1000)).toEqual([1012, 988]);
    expect(() => R.newMatch(9, 0)).toThrow();
  });
  it('rejects invalid turns', () => {
    const s = R.newMatch(0, 1);
    expect(() => R.resolveTurn(s, [4, 0], new Uint8Array(32), [0, 0])).toThrow();
  });
  it('mood is signed through the wire', () => {
    const s = R.newMatch(5, 5);
    const rnd = new Uint8Array(32);
    rnd[2] = rnd[3] = 200;
    rnd[4] = rnd[5] = 15;
    const dmg = (m: R.Mood) => (R.resolveTurn(s, [0, 3], rnd, [m, 0]).events.find((e) => e.t === 'hit') as any).dmg;
    expect(dmg(1)).toBeGreaterThan(dmg(0));
    expect(dmg(-1)).toBeLessThanOrEqual(dmg(0));
  });
});

describe('levels and xp (wasm == rust)', () => {
  it('levelForXp matches the table over the full range', () => {
    const table = [0, 30, 70, 120, 180, 250, 330, 420, 520, 630];
    for (let xp = 0; xp <= 700; xp++) {
      let want = 0;
      for (let l = 0; l < table.length; l++) if (xp >= table[l]) want = l;
      expect(R.levelForXp(xp), `xp ${xp}`).toBe(want);
    }
  });
  it('levels change the match state and survive the byte round trip', () => {
    const s = R.newMatch(0, 1, 5, 9);
    expect(s.f[0].level).toBe(5);
    expect(s.f[1].level).toBe(9);
    expect(s.f[0].maxHp).toBeGreaterThan(R.newMatch(0, 1).f[0].maxHp);
    const r = R.resolveTurn(s, [0, 2], new Uint8Array(32));
    expect(r.state.f[0].level).toBe(5);
  });
  it('xp gain, evolution stages and bot levels', () => {
    expect(R.xpGain(true, 1000, 1000)).toBe(25);
    expect(R.xpGain(false, 1000, 1000)).toBe(8);
    expect(R.evolutionStage(2)).toBe(0);
    expect(R.evolutionStage(3)).toBe(1);
    expect(R.evolutionStage(6)).toBe(2);
    expect(R.botLevel(R.TIER.DUMMY, 9)).toBe(0);
    expect(R.botLevel(R.TIER.PRO, 4)).toBe(4);
  });
});
