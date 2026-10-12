//! Writes rules/fixtures/{turns,bots,replays}.json deterministically.
//! `cargo run -p duel-rules --example gen_fixtures` (add `-- --check` to verify files are up to date).
use duel_rules::*;
use std::fmt::Write;
use std::fs;
use std::path::PathBuf;

struct Rng(u64);
impl Rng {
    fn next(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9E3779B97F4A7C15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58476D1CE4E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D049BB133111EB);
        z ^ (z >> 31)
    }
    fn below(&mut self, n: u64) -> u64 {
        self.next() % n
    }
    fn rnd32(&mut self) -> [u8; 32] {
        let mut r = [0u8; 32];
        for c in r.chunks_mut(8) {
            c.copy_from_slice(&self.next().to_le_bytes());
        }
        r
    }
}

fn hex(b: &[u8]) -> String {
    b.iter().map(|x| format!("{:02x}", x)).collect()
}

fn random_mood(r: &mut Rng) -> [i8; 2] {
    [r.below(3) as i8 - 1, r.below(3) as i8 - 1]
}

fn walk(r: &mut Rng, s: &mut MatchState, turns: u64) {
    for _ in 0..turns {
        if s.is_over() {
            break;
        }
        let rnd = r.rnd32();
        let picks = [r.below(4) as u8, r.below(4) as u8];
        let m = random_mood(r);
        resolve_turn(s, picks, &rnd, m);
    }
}

fn main() {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../rules/fixtures");
    fs::create_dir_all(&root).unwrap();
    let check = std::env::args().any(|a| a == "--check");
    let mut ok = true;
    let mut emit = |name: &str, body: String| {
        let path = root.join(name);
        if check {
            if fs::read_to_string(&path).map(|c| c != body).unwrap_or(true) {
                eprintln!("{} is stale", name);
                ok = false;
            }
        } else {
            fs::write(&path, body).unwrap();
            println!("wrote {}", path.display());
        }
    };

    // ---- turns.json
    let mut r = Rng(0x7475726e73);
    let mut out = String::from("[\n");
    let n = 640;
    for i in 0..n {
        let (a, b) = if i < 64 { ((i / 8) as u8, (i % 8) as u8) } else { (r.below(8) as u8, r.below(8) as u8) };
        let mut s = MatchState::new(a, b).unwrap();
        let depth = if i % 10 == 0 { 15 } else { r.below(8) };
        walk(&mut r, &mut s, depth);
        if s.is_over() {
            s = MatchState::new(a, b).unwrap();
        }
        if i % 10 == 0 {
            // force a turn-limit decision state
            s.turn = MAX_TURNS - 1;
            if r.below(3) == 0 {
                s.f[0].hp = s.f[0].max_hp;
                s.f[1].hp = s.f[1].max_hp;
            }
        }
        if i % 7 == 0 {
            s.f[r.below(2) as usize].hp = 1 + r.below(12) as u16; // KO pressure
        }
        let picks = [r.below(4) as u8, r.below(4) as u8];
        let mut rnd = r.rnd32();
        if i % 5 == 0 {
            rnd[6] = (i % 2) as u8; // exercise speed tie
        }
        let mood = random_mood(&mut r);
        let before = s;
        let ev = resolve_turn(&mut s, picks, &rnd, mood);
        write!(
            out,
            "  {{\"id\":{},\"state\":{},\"picks\":[{},{}],\"rnd\":\"{}\",\"mood\":[{},{}],\"expect\":{{\"state\":{},\"events\":{}}}}}{}\n",
            i, before, picks[0], picks[1], hex(&rnd), mood[0], mood[1], s, ev,
            if i + 1 < n { "," } else { "" }
        )
        .unwrap();
    }
    out.push_str("]\n");
    emit("turns.json", out);

    // ---- bots.json
    let mut r = Rng(0x626f7473);
    let mut out = String::from("[\n");
    let n = 256;
    for i in 0..n {
        let (a, b) = (r.below(8) as u8, r.below(8) as u8);
        let mut s = MatchState::new(a, b).unwrap();
        let d = r.below(6);
        walk(&mut r, &mut s, d);
        if s.is_over() {
            s = MatchState::new(a, b).unwrap();
        }
        let side = r.below(2) as u8;
        let tier = (i % 3) as u8;
        let mut rnd = r.rnd32();
        if i % 4 == 0 {
            rnd[8] = 255; // force the greedy branch
        }
        let pick = bot_pick(&s, side, &rnd, Tier::from_u8(tier).unwrap());
        write!(
            out,
            "  {{\"id\":{},\"state\":{},\"side\":{},\"tier\":{},\"rnd\":\"{}\",\"pick\":{}}}{}\n",
            i, s, side, tier, hex(&rnd), pick, if i + 1 < n { "," } else { "" }
        )
        .unwrap();
    }
    out.push_str("]\n");
    emit("bots.json", out);

    // ---- replays.json (full matches, bot vs bot / random mix, plus a few invalid logs)
    let mut r = Rng(0x7265706c);
    let mut out = String::from("[\n");
    let n = 80;
    for i in 0..n {
        let (a, b) = (r.below(8) as u8, r.below(8) as u8);
        let mut s = MatchState::new(a, b).unwrap();
        let mut log: Vec<TurnLog> = Vec::new();
        while !s.is_over() {
            let rnd = r.rnd32();
            let picks = if i % 4 == 0 {
                [r.below(4) as u8, r.below(4) as u8]
            } else {
                [bot_pick(&s, 0, &rnd, Tier::Pro), bot_pick(&s, 1, &rnd, Tier::Pro)]
            };
            let mood = if i % 3 == 0 { random_mood(&mut r) } else { [0, 0] };
            resolve_turn(&mut s, picks, &rnd, mood);
            let mut r10 = [0u8; RND_USED];
            r10.copy_from_slice(&rnd[..RND_USED]);
            log.push(TurnLog { picks, rnd: r10, mood });
        }
        let mut turns_hex = String::new();
        for t in &log {
            turns_hex.push_str(&hex(&t.to_bytes()));
        }
        // variants: 0 ok, 1 truncated (Unfinished), 2 trailing
        let mut variants = Vec::new();
        let outcome = replay([a, b], &log).unwrap();
        variants.push(format!(
            "{{\"log\":\"{}\",\"expect\":{{\"ok\":true,\"winner\":{},\"hp\":[{},{}],\"turns\":{}}}}}",
            turns_hex, outcome.winner, outcome.hp[0], outcome.hp[1], outcome.turns
        ));
        if i % 8 == 0 {
            let mut cut = log.clone();
            cut.pop();
            let mut extra = log.clone();
            extra.push(log[0]);
            for variant in [cut, extra] {
                let mut h = String::new();
                for t in &variant {
                    h.push_str(&hex(&t.to_bytes()));
                }
                let e = replay([a, b], &variant).expect_err("variant must be invalid");
                variants.push(format!("{{\"log\":\"{}\",\"expect\":{{\"ok\":false,\"error\":\"{}\"}}}}", h, e.code()));
            }
        }
        write!(
            out,
            "  {{\"id\":{},\"species\":[{},{}],\"variants\":[{}]}}{}\n",
            i, a, b, variants.join(","), if i + 1 < n { "," } else { "" }
        )
        .unwrap();
    }
    out.push_str("]\n");
    emit("replays.json", out);
    if !ok {
        std::process::exit(1);
    }
}
