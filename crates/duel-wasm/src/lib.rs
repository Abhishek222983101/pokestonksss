//! WASM bindings. All structured values cross the boundary as JSON strings or flat byte arrays so output is
//! byte-identical to the fixtures produced by `duel-rules`.
use duel_rules::{
    bot_pick, elo_update, preview_damage, replay, resolve_turn, MatchState, Tier, TurnLog, STATE_BYTES, TURN_LOG_BYTES,
};
use wasm_bindgen::prelude::*;

const ROSTER_JSON: &str = include_str!("../../../rules/roster.json");

fn err(code: &str) -> String {
    format!("{{\"ok\":false,\"error\":\"{}\"}}", code)
}

fn state_from(b: &[u8]) -> Option<MatchState> {
    let a: &[u8; STATE_BYTES] = b.try_into().ok()?;
    MatchState::from_bytes(a)
}

/// Roster definition (`rules/roster.json`) as JSON text.
#[wasm_bindgen]
pub fn roster() -> String {
    ROSTER_JSON.to_string()
}

/// New match state JSON `{turn,winner,f:[..]}`; `{"ok":false,...}` if a species is invalid.
#[wasm_bindgen(js_name = newMatch)]
pub fn new_match(a: u8, b: u8) -> String {
    match MatchState::new(a, b) {
        Some(s) => s.to_string(),
        None => err("bad_species"),
    }
}

/// `state`: 16 bytes (see MatchState::to_bytes), `picks`: 2 bytes, `rnd`: 32 bytes (only [0..10] used),
/// `mood`: 2 bytes (i8 as u8). Returns `{"ok":true,"state":{..},"events":[..]}` or `{"ok":false,"error":..}`.
#[wasm_bindgen(js_name = resolveTurn)]
pub fn resolve_turn_js(state: &[u8], picks: &[u8], rnd: &[u8], mood: &[u8]) -> String {
    let (Some(mut st), Ok(p), Ok(r), Ok(m)) = (
        state_from(state),
        <[u8; 2]>::try_from(picks),
        <[u8; 32]>::try_from(rnd),
        <[u8; 2]>::try_from(mood),
    ) else {
        return err("bad_input");
    };
    if st.is_over() || p[0] > 3 || p[1] > 3 {
        return err("invalid_turn");
    }
    let ev = resolve_turn(&mut st, p, &r, [m[0] as i8, m[1] as i8]);
    format!("{{\"ok\":true,\"state\":{},\"events\":{}}}", st, ev)
}

/// House Agent pick (0..=3), or -1 on bad input. `tier`: 0 Rookie, 1 Pro, 2 Champion.
#[wasm_bindgen(js_name = botPick)]
pub fn bot_pick_js(state: &[u8], side: u8, rnd: &[u8], tier: u8) -> i32 {
    let (Some(st), Ok(r), Some(t)) = (state_from(state), <[u8; 32]>::try_from(rnd), Tier::from_u8(tier)) else {
        return -1;
    };
    if side > 1 {
        return -1;
    }
    bot_pick(&st, side, &r, t) as i32
}

/// `species`: 2 bytes; `log`: N * 14 bytes (picks[2] | rnd[10] | mood[2]).
/// Returns `{"ok":true,"winner":..,"hp":[..],"turns":..}` or `{"ok":false,"error":code}`.
#[wasm_bindgen(js_name = replay)]
pub fn replay_js(species: &[u8], log: &[u8]) -> String {
    let Ok(sp) = <[u8; 2]>::try_from(species) else { return err("bad_input") };
    if log.len() % TURN_LOG_BYTES != 0 {
        return err("bad_input");
    }
    let turns: Vec<TurnLog> = log
        .chunks_exact(TURN_LOG_BYTES)
        .map(|c| TurnLog::from_bytes(c.try_into().unwrap()))
        .collect();
    match replay(sp, &turns) {
        Ok(o) => format!("{{\"ok\":true,\"winner\":{},\"hp\":[{},{}],\"turns\":{}}}", o.winner, o.hp[0], o.hp[1], o.turns),
        Err(e) => err(e.code()),
    }
}

/// `{"ok":true,"min":..,"max":..,"eff":..,"acc":..}` for `side`'s strike `slot` vs the opponent (no guard/charge on
/// the defender); `mood` is -1/0/1 for the attacker.
#[wasm_bindgen(js_name = previewDamage)]
pub fn preview_damage_js(state: &[u8], side: u8, slot: u8, mood: i8) -> String {
    let Some(st) = state_from(state) else { return err("bad_input") };
    match preview_damage(&st, side, slot, mood) {
        Some((min, max, e, acc)) => {
            format!("{{\"ok\":true,\"min\":{},\"max\":{},\"eff\":{},\"acc\":{}}}", min, max, e, acc)
        }
        None => err("not_a_strike"),
    }
}

/// `[newWinnerRating, newLoserRating]`.
#[wasm_bindgen(js_name = eloUpdate)]
pub fn elo_update_js(winner: i32, loser: i32) -> Vec<i32> {
    let (w, l) = elo_update(winner, loser);
    vec![w, l]
}

