//! How hard is each House Agent tier for a human? Models three human styles vs each tier.
//! `cargo run -p duel-rules --example vs_human --release`
use duel_rules::*;

struct Rng(u64);
impl Rng {
    fn next(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9E3779B97F4A7C15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58476D1CE4E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D049BB133111EB);
        z ^ (z >> 31)
    }
}

/// style 0 = uniformly random, 1 = "aggressive" (Pump 70%), 2 = thinking human (bot logic at Champion, a ceiling)
fn human_pick(style: u8, s: &MatchState, rnd: &[u8; 32]) -> u8 {
    match style {
        0 => rnd[12] % 4,
        1 => if rnd[12] % 10 < 7 { rnd[13] % 2 } else { 2 + rnd[13] % 2 },
        _ => bot_pick(s, 0, rnd, Tier::Champion),
    }
}

fn main() {
    let mut rng = Rng(7);
    let names = ["Trainee", "Rookie", "Pro", "Champion"];
    let styles = ["random", "aggressive", "ceiling(Champion-level)"];
    for style in 0..3u8 {
        for (ti, t) in [Tier::Trainee, Tier::Rookie, Tier::Pro, Tier::Champion].iter().enumerate() {
            let (mut w, mut n, mut turns) = (0u32, 0u32, 0u32);
            for a in 0..8u8 { for b in 0..8u8 { for _ in 0..300 {
                let mut s = MatchState::new(a, b).unwrap();
                while !s.is_over() {
                    let mut rnd = [0u8; 32];
                    for c in rnd.chunks_mut(8) { c.copy_from_slice(&rng.next().to_le_bytes()); }
                    let p0 = human_pick(style, &s, &rnd);
                    let p1 = bot_pick(&s, 1, &rnd, *t);
                    resolve_turn(&mut s, [p0, p1], &rnd, [0, 0]);
                }
                n += 1; turns += s.turn as u32; if s.winner == 0 { w += 1; }
            }}}
            println!("{:<26} vs {:<9} human win rate {:>5.1}%  avg turns {:.1}", styles[style as usize], names[ti], 100.0 * w as f64 / n as f64, turns as f64 / n as f64);
        }
    }
}
