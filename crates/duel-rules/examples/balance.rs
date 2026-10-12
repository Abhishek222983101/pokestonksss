//! Bot-vs-bot balance simulator: all 64 ordered pairings x N seeded fights, House Agent (Pro tier) on both sides.
//! `cargo run -p duel-rules --example balance --release [-- <fights_per_pairing>] [--json]`
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

fn fight(a: u8, b: u8, rng: &mut Rng) -> (u8, u8) {
    let mut s = MatchState::new(a, b).unwrap();
    while !s.is_over() {
        let mut rnd = [0u8; 32];
        for c in rnd.chunks_mut(8) {
            c.copy_from_slice(&rng.next().to_le_bytes());
        }
        // each side picks from its own view; bot rolls for side 1 are decorrelated from side 0
        let mut rnd1 = rnd;
        rnd1[8] = rnd[10];
        rnd1[9] = rnd[11];
        let p0 = bot_pick(&s, 0, &rnd, Tier::Pro);
        let p1 = bot_pick(&s, 1, &rnd1, Tier::Pro);
        resolve_turn(&mut s, [p0, p1], &rnd, [0, 0]);
    }
    (s.winner, s.turn)
}

fn main() {
    let n: u64 = std::env::args().skip(1).find_map(|a| a.parse().ok()).unwrap_or(2000);
    let mut wins = [[0u64; 8]; 8];
    let mut turns = 0u64;
    let mut total = 0u64;
    for a in 0..8u8 {
        for b in 0..8u8 {
            let mut rng = Rng(((a as u64) << 8 | b as u64) * 7919 + 12345);
            for _ in 0..n {
                let (w, t) = fight(a, b, &mut rng);
                if w == 0 {
                    wins[a as usize][b as usize] += 1;
                }
                turns += t as u64;
                total += 1;
            }
        }
    }
    // win rate matrix: row = species as side0 vs col as side1 (side0 win%)
    println!("Win-rate matrix (row BrokerMon vs column; averaged over both seatings), %");
    print!("{:10}", "");
    for b in 0..8 {
        print!("{:>9}", &NAMES[b][..NAMES[b].len().min(8)]);
    }
    println!();
    let mut worst = 0.0f64;
    let rate = |a: usize, b: usize| -> f64 {
        // a's wins as side0 vs b + a's wins as side1 vs b
        let w = wins[a][b] + (n - wins[b][a]);
        w as f64 * 100.0 / (2 * n) as f64
    };
    for a in 0..8 {
        print!("{:10}", NAMES[a]);
        for b in 0..8 {
            let r = rate(a, b);
            if a != b {
                worst = worst.max(r.max(100.0 - r));
            }
            print!("{:>9.1}", r);
        }
        println!();
    }
    println!("\nOverall win rate (all 128 seatings per species incl. mirrors):");
    let mut ok = true;
    for a in 0..8 {
        let mut w = 0u64;
        for b in 0..8 {
            w += wins[a][b] + (n - wins[b][a]);
        }
        let pct = w as f64 * 100.0 / (16 * n) as f64;
        let flag = if (42.0..=58.0).contains(&pct) { "ok" } else { ok = false; "OUT" };
        println!("  {:10} {:5.1}%  {}", NAMES[a], pct, flag);
    }
    // side0 seat bias
    let s0: u64 = wins.iter().flatten().sum();
    let avg = turns as f64 / total as f64;
    println!("\nSeat-0 win rate {:.1}%   worst non-mirror pairing {:.1}%   avg turns {:.2}   fights {}", s0 as f64 * 100.0 / total as f64, worst, avg, total);
    let pass = ok && worst <= 70.0 && (5.0..=9.0).contains(&avg);
    println!("{}", if pass { "BALANCE PASS" } else { "BALANCE FAIL" });
}
