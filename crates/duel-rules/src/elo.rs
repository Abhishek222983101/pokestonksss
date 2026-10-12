/// Expected score x1000 for rating difference 0,50,..,800 (standard logistic, 400 scale).
const E: [i32; 17] = [500, 571, 640, 703, 760, 808, 849, 882, 909, 930, 947, 960, 969, 977, 983, 987, 990];

/// Expected win probability x1000 of a player rated `r` against `opp` (linear interpolation, clamped at +-800).
pub fn expected_permille(r: i32, opp: i32) -> i32 {
    let diff = (r as i64 - opp as i64).clamp(-800, 800) as i32;
    let a = diff.abs();
    let (i, rem) = ((a / 50) as usize, a % 50);
    let hi = if i >= 16 { E[16] } else { E[i] + (E[i + 1] - E[i]) * rem / 50 };
    if diff >= 0 {
        hi
    } else {
        1000 - hi
    }
}

/// Integer Elo, K=24. Returns `(new_winner, new_loser)`. Winner gains `max(1, K*(1-E)/1000)` (floor); the loser loses
/// the same amount (zero-sum) but never drops below 0.
pub fn elo_update(rw: i32, rl: i32) -> (i32, i32) {
    let e = expected_permille(rw, rl);
    let gain = (24 * (1000 - e) / 1000).max(1);
    (rw + gain, (rl - gain).max(0))
}
