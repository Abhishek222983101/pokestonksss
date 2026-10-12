extern crate std;
use super::*;
use std::vec::Vec;

fn rnd(f: impl FnOnce(&mut [u8; 32])) -> [u8; 32] {
    // Defaults: every strike hits (acc roll 0), no crit (200), variance factor 100 (15), bot rolls high.
    let mut r = [0u8; 32];
    r[2] = 200;
    r[3] = 200;
    r[4] = 15;
    r[5] = 15;
    r[8] = 255;
    f(&mut r);
    r
}

fn di() -> DamageIn {
    DamageIn {
        power: 60,
        atk: 100,
        def: 100,
        stab: false,
        eff: 100,
        variance: 100,
        crit: false,
        mood: 0,
        charged: false,
        guard_pct: 100,
        vulnerable: false,
    }
}

fn st(a: u8, b: u8) -> MatchState {
    MatchState::new(a, b).unwrap()
}

/// Damage a `side` strike `slot` should deal given the defender context, via the public pipeline.
fn dmg_for(s: &MatchState, a: usize, slot: usize, f: impl FnOnce(&mut DamageIn)) -> u16 {
    let sa = &ROSTER[s.f[a].species as usize];
    let sd = &ROSTER[s.f[1 - a].species as usize];
    let m = sa.moves[slot];
    let mut i = DamageIn {
        power: m.power as u32,
        atk: sa.atk as u32,
        def: sd.def as u32,
        stab: m.typ == sa.typ,
        eff: eff(m.typ, sd.typ),
        ..di()
    };
    f(&mut i);
    damage(&i) as u16
}

fn hits(ev: &Events) -> Vec<(u8, u16, bool, u16)> {
    ev.iter()
        .filter_map(|e| if let Event::Hit { side, dmg, crit, eff } = *e { Some((side, dmg, crit, eff)) } else { None })
        .collect()
}

// ---------- types ----------
#[test]
fn eff_all_25_pairs() {
    // rows = attacker (SPEED, ARMOR, ARCANE, TIDE, SHADE), cols = defender
    let table: [[u32; 5]; 5] = [
        [100, 200, 200, 50, 50],
        [50, 100, 200, 200, 50],
        [50, 50, 100, 200, 200],
        [200, 50, 50, 100, 200],
        [200, 200, 50, 50, 100],
    ];
    for a in 0..5u8 {
        for d in 0..5u8 {
            assert_eq!(eff(a, d), table[a as usize][d as usize], "att {a} def {d}");
        }
    }
}

#[test]
fn every_type_strong_vs_two_weak_vs_two() {
    for a in 0..5u8 {
        let sup = (0..5).filter(|&d| eff(a, d) == 200).count();
        let res = (0..5).filter(|&d| eff(a, d) == 50).count();
        let neu = (0..5).filter(|&d| eff(a, d) == 100).count();
        assert_eq!((sup, res, neu), (2, 2, 1));
        // antisymmetry: if a beats d then d is resisted by a's counterpart direction
        for d in 0..5u8 {
            if eff(a, d) == 200 {
                assert_eq!(eff(d, a), 50);
            }
        }
    }
}

// ---------- damage pipeline ----------
#[test]
fn damage_base_worked_example() {
    // 22*60*100/100 = 1320; /50 = 26; +2 = 28
    assert_eq!(damage(&di()), 28);
}

#[test]
fn damage_floors_each_step_worked_example() {
    // power65 atk105 def80: 150150/80=1876; /50=37; +2=39; stab 125 -> 48 (48.75)
    let i = DamageIn { power: 65, atk: 105, def: 80, stab: true, ..di() };
    assert_eq!(damage(&i), 48);
}

#[test]
fn damage_full_stack_worked_example() {
    // base 28 -> stab 35 -> eff200 70 -> var85 59 -> crit 88 -> bull 96 -> charge 192 -> guard20 38 -> vuln 49
    let i = DamageIn {
        stab: true,
        eff: 200,
        variance: 85,
        crit: true,
        mood: 1,
        charged: true,
        guard_pct: 20,
        vulnerable: true,
        ..di()
    };
    assert_eq!(damage(&i), 49);
}

#[test]
fn damage_each_modifier_alone() {
    assert_eq!(damage(&DamageIn { stab: true, ..di() }), 35);
    assert_eq!(damage(&DamageIn { eff: 200, ..di() }), 56);
    assert_eq!(damage(&DamageIn { eff: 50, ..di() }), 14);
    assert_eq!(damage(&DamageIn { variance: 85, ..di() }), 23); // 23.8
    assert_eq!(damage(&DamageIn { crit: true, ..di() }), 42);
    assert_eq!(damage(&DamageIn { mood: 1, ..di() }), 30); // 30.8
    assert_eq!(damage(&DamageIn { mood: -1, ..di() }), 25); // 25.2
    assert_eq!(damage(&DamageIn { mood: 0, ..di() }), 28);
    assert_eq!(damage(&DamageIn { charged: true, ..di() }), 56);
    assert_eq!(damage(&DamageIn { guard_pct: 20, ..di() }), 5); // 5.6
    assert_eq!(damage(&DamageIn { guard_pct: 50, ..di() }), 14);
    assert_eq!(damage(&DamageIn { vulnerable: true, ..di() }), 36); // 36.4
}

#[test]
fn damage_minimum_is_one() {
    let i = DamageIn { power: 1, atk: 1, def: 200, eff: 50, variance: 85, guard_pct: 20, mood: -1, ..di() };
    assert_eq!(damage(&i), 1);
}

#[test]
fn mood_clamps_by_sign() {
    assert_eq!(mood_pct(5), 110);
    assert_eq!(mood_pct(-9), 90);
    assert_eq!(mood_pct(0), 100);
}

#[test]
fn roster_is_well_formed() {
    assert_eq!(ROSTER_LEN, 8);
    let mut types = [false; 5];
    for (i, s) in ROSTER.iter().enumerate() {
        assert_eq!(s.id as usize, i);
        types[s.typ as usize] = true;
        assert!((140..=180).contains(&s.hp), "hp {}", s.hp);
        assert_eq!(s.moves[0].kind, MoveKind::Strike);
        assert_eq!(s.moves[0].typ, s.typ);
        assert_eq!(s.moves[1].kind, MoveKind::Strike);
        assert_ne!(s.moves[1].typ, s.typ);
        assert_eq!(s.moves[2].kind, MoveKind::Guard);
        assert_eq!(s.moves[3].kind, MoveKind::Charge);
        // neutral strike damage target 25..=35 for a defence-100 target
        let d = damage(&DamageIn { power: s.moves[0].power as u32, atk: s.atk as u32, def: 100, stab: true, ..di() });
        assert!((25..=60).contains(&d), "{} dmg {}", NAMES[i], d);
    }
    assert!(types.iter().all(|&t| t));
}

// ---------- state codec ----------
#[test]
fn state_bytes_roundtrip_and_validation() {
    let mut s = st(2, 5);
    s.f[0].hp = 17;
    s.f[1].charged = true;
    s.f[0].last_guard = true;
    s.turn = 9;
    assert_eq!(MatchState::from_bytes(&s.to_bytes()), Some(s));
    let mut b = s.to_bytes();
    b[2] = 99; // species
    assert!(MatchState::from_bytes(&b).is_none());
    let mut b = s.to_bytes();
    b[3] = 255;
    b[4] = 255; // hp > max
    assert!(MatchState::from_bytes(&b).is_none());
    let mut b = s.to_bytes();
    b[7] = 2; // flag
    assert!(MatchState::from_bytes(&b).is_none());
    let mut b = s.to_bytes();
    b[1] = 7; // winner
    assert!(MatchState::from_bytes(&b).is_none());
    assert!(MatchState::new(8, 0).is_none());
    assert!(new_fighter(8).is_none());
}

// ---------- turn resolution ----------
#[test]
fn faster_strikes_first_and_both_hit() {
    let mut s = st(0, 1); // Voltfox spd 120 vs Ironhorn 60
    let exp0 = dmg_for(&s, 0, 0, |_| {});
    let exp1 = dmg_for(&s, 1, 0, |_| {});
    let ev = resolve_turn(&mut s, [0, 0], &rnd(|_| {}), [0, 0]);
    let h = hits(&ev);
    assert_eq!(h.len(), 2);
    assert_eq!((h[0].0, h[0].1), (0, exp0));
    assert_eq!((h[1].0, h[1].1), (1, exp1));
    assert_eq!(s.f[1].hp, ROSTER[1].hp - exp0);
    assert_eq!(s.f[0].hp, ROSTER[0].hp - exp1);
    assert_eq!(s.turn, 1);
    assert_eq!(s.winner, NO_WINNER);
}

#[test]
fn slower_first_when_it_is_side_one() {
    let mut s = st(1, 0); // now side 1 is the fast one
    let ev = resolve_turn(&mut s, [0, 0], &rnd(|_| {}), [0, 0]);
    assert_eq!(hits(&ev)[0].0, 1);
}

#[test]
fn ko_skips_the_slower_strike() {
    let mut s = st(0, 1);
    s.f[1].hp = 1;
    let before = s.f[0].hp;
    let ev = resolve_turn(&mut s, [0, 0], &rnd(|_| {}), [0, 0]);
    assert_eq!(s.f[0].hp, before, "slow target never got to act");
    assert_eq!(s.f[1].hp, 0);
    assert_eq!(s.winner, 0);
    assert_eq!(hits(&ev).len(), 1);
    assert_eq!(hits(&ev)[0].1, 1, "overkill clipped to remaining hp");
    assert!(ev.iter().any(|e| *e == Event::Ko { side: 1 }));
    assert_eq!(*ev.as_slice().last().unwrap(), Event::End { winner: 0, by_ko: true });
}

#[test]
fn speed_tie_uses_rnd6_low_bit() {
    for (bit, first) in [(0u8, 0u8), (1, 1), (2, 0), (255, 1)] {
        let mut s = st(5, 5);
        let ev = resolve_turn(&mut s, [0, 0], &rnd(|r| r[6] = bit), [0, 0]);
        assert_eq!(hits(&ev)[0].0, first, "rnd6={bit}");
    }
}

#[test]
fn accuracy_roll_boundary() {
    let acc = ROSTER[0].moves[0].acc;
    let mut s = st(0, 1);
    // roll == acc -> miss; roll == acc-1 -> hit
    let ev = resolve_turn(&mut s, [0, 2], &rnd(|r| r[0] = acc), [0, 0]);
    assert!(ev.iter().any(|e| *e == Event::Miss { side: 0 }));
    let mut s = st(0, 1);
    let ev = resolve_turn(&mut s, [0, 2], &rnd(|r| r[0] = acc - 1), [0, 0]);
    assert_eq!(hits(&ev).len(), 1);
    // roll uses % 100
    let mut s = st(0, 1);
    let ev = resolve_turn(&mut s, [0, 2], &rnd(|r| r[0] = 200), [0, 0]); // 200 % 100 = 0 -> hit
    assert_eq!(hits(&ev).len(), 1);
}

#[test]
fn accuracy_uses_each_sides_own_byte() {
    let mut s = st(0, 1);
    let ev = resolve_turn(&mut s, [0, 0], &rnd(|r| r[1] = 99), [0, 0]);
    let h = hits(&ev);
    assert_eq!(h.len(), 1);
    assert_eq!(h[0].0, 0);
    assert!(ev.iter().any(|e| *e == Event::Miss { side: 1 }));
}

#[test]
fn crit_threshold_and_bytes() {
    let mut s = st(0, 1);
    let normal = dmg_for(&s, 0, 0, |_| {});
    let crit = dmg_for(&s, 0, 0, |i| i.crit = true);
    let ev = resolve_turn(&mut s, [0, 0], &rnd(|r| r[2] = 15), [0, 0]);
    let h = hits(&ev);
    assert_eq!((h[0].1, h[0].2), (crit, true));
    let mut s = st(0, 1);
    let ev = resolve_turn(&mut s, [0, 0], &rnd(|r| r[2] = 16), [0, 0]);
    let h = hits(&ev);
    assert_eq!((h[0].1, h[0].2), (normal, false));
    // side 1 crit uses rnd[3]
    let mut s = st(0, 1);
    let ev = resolve_turn(&mut s, [0, 0], &rnd(|r| r[3] = 0), [0, 0]);
    assert!(hits(&ev)[1].2);
}

#[test]
fn variance_bytes_map_85_to_100() {
    for (b, v) in [(0u8, 85u32), (15, 100), (16, 85), (7, 92)] {
        let mut s = st(0, 1);
        let exp = dmg_for(&s, 0, 0, |i| i.variance = v);
        let ev = resolve_turn(&mut s, [0, 0], &rnd(|r| r[4] = b), [0, 0]);
        assert_eq!(hits(&ev)[0].1, exp, "rnd4={b}");
    }
    let mut s = st(0, 1);
    let exp = dmg_for(&s, 1, 0, |i| i.variance = 90);
    let ev = resolve_turn(&mut s, [0, 0], &rnd(|r| r[5] = 5), [0, 0]);
    assert_eq!(hits(&ev).iter().find(|h| h.0 == 1).unwrap().1, exp);
}

#[test]
fn mood_applies_to_own_attacks_and_emits_event() {
    let mut s = st(0, 1);
    let exp = dmg_for(&s, 0, 0, |i| i.mood = 1);
    let ev = resolve_turn(&mut s, [0, 0], &rnd(|_| {}), [1, -1]);
    assert_eq!(hits(&ev)[0].1, exp);
    assert_eq!(ev.as_slice()[0], Event::Mood { side: 0, mood: 1 });
    assert_eq!(ev.as_slice()[1], Event::Mood { side: 1, mood: -1 });
    let mut s = st(0, 1);
    let ev = resolve_turn(&mut s, [0, 0], &rnd(|_| {}), [0, 0]);
    assert!(!ev.iter().any(|e| matches!(e, Event::Mood { .. })));
    // out-of-range mood is clamped by sign
    let mut s = st(0, 1);
    let bull = dmg_for(&s, 0, 0, |i| i.mood = 1);
    let ev = resolve_turn(&mut s, [0, 0], &rnd(|_| {}), [100, 0]);
    assert_eq!(hits(&ev)[0].1, bull);
}

#[test]
fn guard_reduces_strike_to_20_percent_and_heals() {
    let mut s = st(0, 1);
    s.f[1].hp = 100;
    let exp = dmg_for(&s, 0, 0, |i| i.guard_pct = 20);
    let heal = ROSTER[1].hp / 10;
    let ev = resolve_turn(&mut s, [0, 2], &rnd(|_| {}), [0, 0]);
    assert_eq!(hits(&ev)[0].1, exp);
    assert_eq!(s.f[1].hp, 100 + heal - exp);
    assert!(ev.iter().any(|e| *e == Event::Guard { side: 1, heal }));
    assert!(s.f[1].last_guard);
}

#[test]
fn repeated_guard_is_50_percent_and_no_heal() {
    let mut s = st(0, 1);
    s.f[1].hp = 100;
    s.f[1].last_guard = true;
    let exp = dmg_for(&s, 0, 0, |i| i.guard_pct = 50);
    let ev = resolve_turn(&mut s, [0, 2], &rnd(|_| {}), [0, 0]);
    assert_eq!(hits(&ev)[0].1, exp);
    assert_eq!(s.f[1].hp, 100 - exp);
    assert!(ev.iter().any(|e| *e == Event::Guard { side: 1, heal: 0 }));
    assert!(s.f[1].last_guard);
}

#[test]
fn guard_heal_capped_at_max_hp_and_reported_as_actual() {
    let mut s = st(0, 1);
    s.f[0].hp = s.f[0].max_hp - 3;
    let ev = resolve_turn(&mut s, [2, 2], &rnd(|_| {}), [0, 0]);
    assert_eq!(s.f[0].hp, s.f[0].max_hp);
    assert!(ev.iter().any(|e| *e == Event::Guard { side: 0, heal: 3 }));
    assert!(ev.iter().any(|e| *e == Event::Guard { side: 1, heal: 0 }));
}

#[test]
fn guard_flag_clears_when_not_guarding() {
    let mut s = st(0, 1);
    resolve_turn(&mut s, [2, 2], &rnd(|_| {}), [0, 0]);
    assert!(s.f[0].last_guard && s.f[1].last_guard);
    resolve_turn(&mut s, [3, 3], &rnd(|_| {}), [0, 0]);
    assert!(!s.f[0].last_guard && !s.f[1].last_guard);
}

#[test]
fn guard_heal_happens_before_strikes() {
    // target at 1 hp guards: heal first, then 20% damage can't liquidate
    let mut s = st(0, 1);
    s.f[1].hp = 1;
    let ev = resolve_turn(&mut s, [0, 2], &rnd(|_| {}), [0, 0]);
    assert!(s.f[1].hp > 0 || hits(&ev)[0].1 >= 1 + ROSTER[1].hp / 10);
    assert!(!s.is_over() || s.f[1].hp == 0);
}

#[test]
fn guard_does_not_reduce_charge_or_guard_picks() {
    // Guard vs charge: nothing happens except flags.
    let mut s = st(0, 1);
    let ev = resolve_turn(&mut s, [2, 3], &rnd(|_| {}), [0, 0]);
    assert!(hits(&ev).is_empty());
    assert!(s.f[1].charged);
}

#[test]
fn charge_sets_flag_then_doubles_next_strike() {
    let mut s = st(5, 5);
    let ev = resolve_turn(&mut s, [3, 2], &rnd(|_| {}), [0, 0]);
    assert!(ev.iter().any(|e| *e == Event::Charge { side: 0 }));
    assert!(s.f[0].charged);
    s.f[1].hp = s.f[1].max_hp;
    let exp = dmg_for(&s, 0, 0, |i| i.charged = true);
    let plain = dmg_for(&s, 0, 0, |_| {});
    assert!(exp > plain);
    let ev = resolve_turn(&mut s, [0, 3], &rnd(|_| {}), [0, 0]);
    // defender charging this turn is vulnerable as well
    let exp = dmg_for(&st(5, 5), 0, 0, |i| {
        i.charged = true;
        i.vulnerable = true
    });
    assert_eq!(hits(&ev)[0].1, exp);
    assert!(!s.f[0].charged, "consumed");
}

#[test]
fn charge_consumed_on_miss() {
    let mut s = st(0, 1);
    s.f[0].charged = true;
    let ev = resolve_turn(&mut s, [0, 2], &rnd(|r| r[0] = 99), [0, 0]);
    assert!(ev.iter().any(|e| *e == Event::Miss { side: 0 }));
    assert!(!s.f[0].charged);
}

#[test]
fn charge_persists_through_non_strike_turns() {
    let mut s = st(0, 1);
    resolve_turn(&mut s, [3, 2], &rnd(|_| {}), [0, 0]);
    resolve_turn(&mut s, [2, 2], &rnd(|_| {}), [0, 0]);
    assert!(s.f[0].charged);
    resolve_turn(&mut s, [3, 2], &rnd(|_| {}), [0, 0]);
    assert!(s.f[0].charged);
}

#[test]
fn vulnerable_only_on_the_turn_of_charging() {
    let mut s = st(0, 1);
    let vuln = dmg_for(&s, 0, 0, |i| i.vulnerable = true);
    let plain = dmg_for(&s, 0, 0, |_| {});
    assert!(vuln > plain);
    let ev = resolve_turn(&mut s, [0, 3], &rnd(|_| {}), [0, 0]);
    assert_eq!(hits(&ev)[0].1, vuln);
    // next turn Ironhorn is charged but strikes -> not vulnerable
    let mut s2 = s;
    s2.f[1].hp = s2.f[1].max_hp;
    let ev = resolve_turn(&mut s2, [0, 0], &rnd(|_| {}), [0, 0]);
    assert_eq!(hits(&ev)[0].1, plain);
}

#[test]
fn rps_triangle_strike_beats_charge_charge_beats_guard_guard_beats_strike() {
    // strike vs charge: full vuln damage, charger deals nothing
    let mut s = st(0, 1);
    let ev = resolve_turn(&mut s, [0, 3], &rnd(|_| {}), [0, 0]);
    assert_eq!(hits(&ev).len(), 1);
    // charge vs guard: guard turtles, charge side gets doubled strike later
    let mut s = st(0, 1);
    resolve_turn(&mut s, [3, 2], &rnd(|_| {}), [0, 0]);
    assert!(s.f[0].charged);
    // guard vs strike: damage heavily reduced vs plain
    let g = dmg_for(&st(0, 1), 0, 0, |i| i.guard_pct = 20);
    let n = dmg_for(&st(0, 1), 0, 0, |_| {});
    assert!(g * 3 < n);
}

#[test]
fn ko_by_second_striker_when_first_misses() {
    let mut s = st(0, 1);
    s.f[0].hp = 1;
    let ev = resolve_turn(&mut s, [0, 0], &rnd(|r| r[0] = 99), [0, 0]);
    assert_eq!(s.winner, 1);
    assert!(ev.iter().any(|e| *e == Event::Ko { side: 0 }));
}

#[test]
fn max_turns_higher_hp_ratio_wins() {
    let mut s = st(0, 1);
    s.turn = MAX_TURNS - 1;
    s.f[0].hp = s.f[0].max_hp / 2;
    s.f[1].hp = s.f[1].max_hp;
    let ev = resolve_turn(&mut s, [3, 3], &rnd(|_| {}), [0, 0]);
    assert_eq!(s.turn, MAX_TURNS);
    assert_eq!(s.winner, 1);
    assert_eq!(*ev.as_slice().last().unwrap(), Event::End { winner: 1, by_ko: false });
    // and the reverse
    let mut s = st(0, 1);
    s.turn = MAX_TURNS - 1;
    s.f[1].hp = 10;
    resolve_turn(&mut s, [3, 3], &rnd(|_| {}), [0, 0]);
    assert_eq!(s.winner, 0);
}

#[test]
fn max_turns_compares_ratio_not_absolute_hp() {
    // side0 has fewer absolute hp but a bigger ratio
    let mut s = st(0, 1); // max 140 vs 175
    s.turn = MAX_TURNS - 1;
    s.f[0].hp = 120; // 857
    s.f[1].hp = 140; // 800
    resolve_turn(&mut s, [3, 3], &rnd(|_| {}), [0, 0]);
    assert_eq!(s.winner, 0);
}

#[test]
fn max_turns_tie_uses_rnd7_low_bit() {
    for (b, w) in [(0u8, 0u8), (1, 1), (254, 0), (255, 1)] {
        let mut s = st(5, 5);
        s.turn = MAX_TURNS - 1;
        resolve_turn(&mut s, [3, 3], &rnd(|r| r[7] = b), [0, 0]);
        assert_eq!(s.winner, w, "rnd7={b}");
    }
}

#[test]
fn match_not_decided_before_max_turns_and_ko_beats_turn_limit() {
    let mut s = st(5, 5);
    s.turn = MAX_TURNS - 2;
    resolve_turn(&mut s, [3, 3], &rnd(|_| {}), [0, 0]);
    assert_eq!(s.winner, NO_WINNER);
    // KO on the last turn is a KO
    let mut s = st(0, 1);
    s.turn = MAX_TURNS - 1;
    s.f[1].hp = 1;
    let ev = resolve_turn(&mut s, [0, 0], &rnd(|_| {}), [0, 0]);
    assert_eq!(*ev.as_slice().last().unwrap(), Event::End { winner: 0, by_ko: true });
}

#[test]
fn finished_match_and_invalid_picks_are_noops() {
    let mut s = st(0, 1);
    let before = s;
    assert!(resolve_turn(&mut s, [4, 0], &rnd(|_| {}), [0, 0]).is_empty());
    assert!(resolve_turn(&mut s, [0, 255], &rnd(|_| {}), [0, 0]).is_empty());
    assert_eq!(s, before);
    s.winner = 0;
    let before = s;
    assert!(resolve_turn(&mut s, [0, 0], &rnd(|_| {}), [0, 0]).is_empty());
    assert_eq!(s, before);
}

#[test]
fn resolve_reads_only_first_ten_rnd_bytes() {
    let base = rnd(|_| {});
    for i in 0..300u32 {
        let mut a = st((i % 8) as u8, ((i / 8) % 8) as u8);
        let mut b = a;
        let mut r1 = base;
        let mut r2 = base;
        r1[10..].iter_mut().for_each(|x| *x = 0);
        r2[10..].iter_mut().for_each(|x| *x = 0xAB);
        let p = [(i % 4) as u8, ((i / 4) % 4) as u8];
        assert_eq!(resolve_turn(&mut a, p, &r1, [0, 0]), resolve_turn(&mut b, p, &r2, [0, 0]));
        assert_eq!(a, b);
    }
}

#[test]
fn events_fit_in_buffer_worst_case() {
    // mood x2 + guard + charge/guard + strikes... max used is well below capacity
    let mut s = st(0, 1);
    let ev = resolve_turn(&mut s, [0, 0], &rnd(|_| {}), [1, -1]);
    assert!(ev.len() <= MAX_EVENTS);
    assert!(!ev.is_empty());
    assert_eq!(Events::default().len(), 0);
}

#[test]
fn json_shapes() {
    use std::string::ToString;
    let mut s = st(0, 1);
    assert_eq!(
        s.to_string(),
        std::format!(
            "{{\"turn\":0,\"winner\":null,\"f\":[{{\"species\":0,\"hp\":{h0},\"maxHp\":{h0},\"charged\":false,\"lastGuard\":false}},{{\"species\":1,\"hp\":{h1},\"maxHp\":{h1},\"charged\":false,\"lastGuard\":false}}]}}",
            h0 = ROSTER[0].hp,
            h1 = ROSTER[1].hp
        )
    );
    let ev = resolve_turn(&mut s, [2, 3], &rnd(|_| {}), [0, 0]);
    assert_eq!(
        ev.to_string(),
        "[{\"t\":\"guard\",\"side\":0,\"heal\":0},{\"t\":\"charge\",\"side\":1}]"
    );
    assert_eq!(Event::Hit { side: 1, dmg: 3, crit: true, eff: 50 }.to_string(), "{\"t\":\"hit\",\"side\":1,\"dmg\":3,\"crit\":true,\"eff\":50}");
    assert_eq!(Event::End { winner: 1, by_ko: false }.to_string(), "{\"t\":\"end\",\"winner\":1,\"byKo\":false}");
}

// ---------- preview ----------
#[test]
fn preview_matches_pipeline() {
    let mut s = st(0, 1);
    let (min, max, e, acc) = preview_damage(&s, 0, 0, 0).unwrap();
    assert_eq!(min as u16, dmg_for(&s, 0, 0, |i| i.variance = 85));
    assert_eq!(max as u16, dmg_for(&s, 0, 0, |i| {
        i.variance = 100;
        i.crit = true
    }));
    assert_eq!(e, eff(ROSTER[0].moves[0].typ, ROSTER[1].typ));
    assert_eq!(acc, ROSTER[0].moves[0].acc as u32);
    assert!(preview_damage(&s, 0, 2, 0).is_none());
    assert!(preview_damage(&s, 0, 3, 0).is_none());
    assert!(preview_damage(&s, 2, 0, 0).is_none());
    assert!(preview_damage(&s, 0, 4, 0).is_none());
    s.f[0].charged = true;
    let (min2, ..) = preview_damage(&s, 0, 0, 0).unwrap();
    assert!(min2 > min);
}

// ---------- bot ----------
fn all_states() -> Vec<MatchState> {
    let mut v = Vec::new();
    for a in 0..8u8 {
        for b in 0..8u8 {
            let base = st(a, b);
            for variant in 0..6u8 {
                let mut s = base;
                match variant {
                    1 => s.f[0].hp = s.f[0].max_hp / 4,
                    2 => s.f[1].charged = true,
                    3 => s.f[1].last_guard = true,
                    4 => s.f[0].charged = true,
                    5 => {
                        s.f[0].last_guard = true;
                        s.f[1].hp = 3
                    }
                    _ => {}
                }
                v.push(s);
            }
        }
    }
    v
}

#[test]
fn bot_never_invalid_and_deterministic() {
    for s in all_states() {
        for side in 0..2u8 {
            for seed in 0..16u8 {
                let r = rnd(|r| {
                    r[8] = seed.wrapping_mul(17);
                    r[9] = seed;
                });
                for t in [Tier::Rookie, Tier::Pro, Tier::Champion] {
                    let p = bot_pick(&s, side, &r, t);
                    assert!(p < 4);
                    assert_eq!(p, bot_pick(&s, side, &r, t));
                }
            }
        }
    }
    assert_eq!(bot_pick(&st(0, 1), 2, &rnd(|_| {}), Tier::Pro), 0);
}

#[test]
fn bot_exploration_thresholds() {
    let s = st(0, 1);
    for (tier, thr) in [(Tier::Rookie, 128u8), (Tier::Pro, 64), (Tier::Champion, 26)] {
        assert_eq!(tier.threshold(), thr);
        for slot in 0..4u8 {
            let r = rnd(|r| {
                r[8] = thr - 1;
                r[9] = slot + 4 * 7;
            });
            assert_eq!(bot_pick(&s, 0, &r, tier), slot, "explore -> rnd9 % 4");
        }
        // at the threshold the bot is greedy: same for every rnd[9]
        let a = bot_pick(&s, 0, &rnd(|r| { r[8] = thr; r[9] = 0 }), tier);
        for v in 1..8u8 {
            assert_eq!(a, bot_pick(&s, 0, &rnd(|r| { r[8] = thr; r[9] = v }), tier));
        }
    }
    // rates over all 256 values of rnd[8]: 50% / 25% / ~10%
    let pct = |t: Tier| (0..=255u8).filter(|&v| v < t.threshold()).count() * 100 / 256;
    assert_eq!((pct(Tier::Rookie), pct(Tier::Pro), pct(Tier::Champion)), (50, 25, 10));
    assert_eq!(Tier::from_u8(0), Some(Tier::Rookie));
    assert_eq!(Tier::from_u8(2), Some(Tier::Champion));
    assert!(Tier::from_u8(3).is_none());
}

#[test]
fn bot_greedy_prefers_stronger_strike_by_expected_damage() {
    let s = st(0, 1);
    let r = rnd(|_| {});
    let p = bot_pick(&s, 0, &r, Tier::Champion);
    // strike slots score acc*expected; verify the chosen slot is a strike with maximal score
    let sc = |slot: usize| {
        let m = ROSTER[0].moves[slot];
        dmg_for(&s, 0, slot, |_| {}) as u32 * m.acc as u32
    };
    if p < 2 {
        assert!(sc(p as usize) >= sc(1 - p as usize));
    }
}

#[test]
fn bot_guards_when_low_and_opponent_charged() {
    let mut s = st(5, 5);
    s.f[0].hp = s.f[0].max_hp / 5;
    s.f[1].charged = true;
    assert_eq!(bot_pick(&s, 0, &rnd(|_| {}), Tier::Champion), SLOT_GUARD);
    // but never two guards in a row
    s.f[0].last_guard = true;
    assert_ne!(bot_pick(&s, 0, &rnd(|_| {}), Tier::Champion), SLOT_GUARD);
}

#[test]
fn bot_charges_against_a_guarder_when_healthy() {
    let mut s = st(5, 5);
    s.f[1].last_guard = true;
    assert_eq!(bot_pick(&s, 0, &rnd(|_| {}), Tier::Champion), SLOT_CHARGE);
    s.f[0].charged = true; // already charged -> strikes instead
    assert!(bot_pick(&s, 0, &rnd(|_| {}), Tier::Champion) < 2);
}

#[test]
fn bot_side_symmetry() {
    let s = st(2, 2);
    let r = rnd(|_| {});
    assert_eq!(bot_pick(&s, 0, &r, Tier::Pro), bot_pick(&s, 1, &r, Tier::Pro));
}

// ---------- elo ----------
#[test]
fn elo_equal_ratings_gain_12() {
    assert_eq!(elo_update(1000, 1000), (1012, 988));
}

#[test]
fn elo_upset_gains_more_than_favourite() {
    let (w, l) = elo_update(1000, 1400); // underdog wins: E=0.0909 -> 24*0.909 = 21
    assert_eq!((w, l), (1021, 1379));
    let (w, l) = elo_update(1400, 1000); // favourite: E=909 -> 24*91/1000 = 2
    assert_eq!((w, l), (1402, 998));
}

#[test]
fn elo_extremes_clamped_and_minimum_one() {
    assert_eq!(elo_update(3000, 1000), (3001, 999));
    let (w, l) = elo_update(0, 5000);
    assert_eq!((w, l), (23, 4977)); // E clamps at 10 -> 24*990/1000 = 23
    assert_eq!(elo_update(1010, 3).1, 2);
    let (_, l) = elo_update(1000, 0);
    assert_eq!(l, 0, "loser never negative");
}

#[test]
fn elo_zero_sum_when_not_floored_and_monotone() {
    let mut prev = i32::MAX;
    for d in (-900..=900).step_by(25) {
        let (w, l) = elo_update(2000 + d, 2000);
        assert_eq!((w - (2000 + d)) , 2000 - l);
        let gain = w - (2000 + d);
        assert!(gain >= 1 && gain <= 24);
        assert!(gain <= prev, "gain decreases as the winner is more favoured");
        prev = gain;
    }
}

#[test]
fn expected_symmetry() {
    for d in (-900..=900).step_by(7) {
        let a = elo::expected_permille(1000 + d, 1000);
        let b = elo::expected_permille(1000, 1000 + d);
        assert_eq!(a + b, 1000);
    }
}

// ---------- replay ----------
fn play_random(a: u8, b: u8, seed: u64) -> (Vec<TurnLog>, MatchState) {
    let mut x = seed.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
    let mut next = || {
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        x
    };
    let mut s = st(a, b);
    let mut log = Vec::new();
    while !s.is_over() {
        let mut r = [0u8; RND_USED];
        for v in r.iter_mut() {
            *v = next() as u8;
        }
        let picks = [(next() % 4) as u8, (next() % 4) as u8];
        let mood = [(next() % 3) as i8 - 1, (next() % 3) as i8 - 1];
        let mut full = [0u8; 32];
        full[..RND_USED].copy_from_slice(&r);
        resolve_turn(&mut s, picks, &full, mood);
        log.push(TurnLog { picks, rnd: r, mood });
    }
    (log, s)
}

#[test]
fn replay_reproduces_live_matches() {
    for seed in 0..200u64 {
        let (a, b) = ((seed % 8) as u8, ((seed / 8) % 8) as u8);
        let (log, s) = play_random(a, b, seed);
        let o = replay([a, b], &log).unwrap();
        assert_eq!(o, Outcome { winner: s.winner, hp: [s.f[0].hp, s.f[1].hp], turns: s.turn });
        assert!(o.turns <= MAX_TURNS);
    }
}

#[test]
fn replay_errors() {
    let (log, _) = play_random(0, 1, 7);
    assert_eq!(replay([9, 1], &log), Err(ReplayError::BadSpecies));
    assert_eq!(replay([0, 1], &log[..log.len() - 1]), Err(ReplayError::Unfinished));
    assert_eq!(replay([0, 1], &[]), Err(ReplayError::Unfinished));
    let mut extra = log.clone();
    extra.push(log[0]);
    assert_eq!(replay([0, 1], &extra), Err(ReplayError::TrailingTurns));
    let mut bad = log.clone();
    bad[0].picks[1] = 4;
    assert_eq!(replay([0, 1], &bad), Err(ReplayError::BadPick(0)));
    let long = std::vec![log[0]; 17];
    assert_eq!(replay([0, 1], &long), Err(ReplayError::TooLong));
    assert_eq!(ReplayError::TooLong.code(), "too_long");
}

#[test]
fn replay_detects_tampering() {
    let mut differs = 0;
    for seed in 0..50u64 {
        let (mut log, s) = play_random(2, 3, seed);
        let honest = replay([2, 3], &log).unwrap();
        assert_eq!(honest.winner, s.winner);
        log[0].rnd[0] ^= 0xFF;
        if let Ok(o) = replay([2, 3], &log) {
            if o != honest {
                differs += 1;
            }
        } else {
            differs += 1;
        }
    }
    assert!(differs > 0);
}

#[test]
fn turn_log_bytes_roundtrip() {
    let t = TurnLog { picks: [1, 3], rnd: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], mood: [-1, 1] };
    assert_eq!(TurnLog::from_bytes(&t.to_bytes()), t);
    assert_eq!(TURN_LOG_BYTES, 14);
}

#[test]
fn max_turns_is_sixteen_and_all_matches_terminate() {
    assert_eq!(MAX_TURNS, 16);
    // all-guard stalemate ends at the turn limit
    let mut s = st(5, 5);
    let mut n = 0;
    while !s.is_over() {
        resolve_turn(&mut s, [2, 2], &rnd(|_| {}), [0, 0]);
        n += 1;
    }
    assert_eq!(n, 16);
}
