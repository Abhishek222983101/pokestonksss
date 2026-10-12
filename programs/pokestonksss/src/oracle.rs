//! MagicBlock real-time pricing oracle reader (hand-parsed; the Pyth SDK parser fails on these accounts).
//! Layout (134 B): disc[8] | write_authority[32] | verification_level(1) | feed_id[32] | price i64 @73 |
//! conf u64 @81 | exponent i32 @89 (+8 live) | publish_time i64 @93 (seconds) | ... | posted_slot u64 @125.
use crate::consts::*;
use anchor_lang::prelude::*;

pub const PRICE_UPDATE_V3_DISC: [u8; 8] = [234, 161, 14, 36, 172, 239, 15, 232];
pub const PRICE_UPDATE_V2_DISC: [u8; 8] = [34, 241, 35, 99, 157, 126, 244, 205];

/// PDA of the price feed account for a Pyth Lazer feed id (decimal string used as the 3rd seed).
pub fn feed_pda(feed_id: u16) -> Pubkey {
    let mut buf = [0u8; 5];
    let mut n = feed_id as u32;
    let mut i = buf.len();
    loop {
        i -= 1;
        buf[i] = b'0' + (n % 10) as u8;
        n /= 10;
        if n == 0 {
            break;
        }
    }
    Pubkey::find_program_address(&[b"price_feed", b"pyth-lazer", &buf[i..]], &ORACLE_PROGRAM_ID).0
}

/// Parses raw account bytes. `None` on any identity/freshness/shape problem (oracle is best-effort).
pub fn parse_price(key: &Pubkey, owner: &Pubkey, d: &[u8], now: i64, max_age: i64) -> Option<i64> {
    if *owner != ORACLE_PROGRAM_ID || d.len() < 133 {
        return None;
    }
    if d[0..8] != PRICE_UPDATE_V3_DISC && d[0..8] != PRICE_UPDATE_V2_DISC {
        return None;
    }
    if d[40] != 1 || d[41..73] != *key.as_ref() {
        return None;
    }
    let price = i64::from_le_bytes(d[73..81].try_into().ok()?);
    let expo = i32::from_le_bytes(d[89..93].try_into().ok()?);
    let publish_time = i64::from_le_bytes(d[93..101].try_into().ok()?);
    let posted_slot = u64::from_le_bytes(d[125..133].try_into().ok()?);
    if price <= 0 || posted_slot == 0 || expo == 0 || expo.unsigned_abs() > 18 {
        return None;
    }
    if (now - publish_time).abs() > max_age {
        return None;
    }
    Some(price)
}

/// Reads the price of `species`' asset from `info`, only if `info` is that species' canonical feed account.
pub fn read_species_price(info: &AccountInfo, species: u8, now: i64) -> Option<i64> {
    let sp = duel_rules::species(species)?;
    if *info.key != feed_pda(sp.feed) {
        return None;
    }
    let data = info.try_borrow_data().ok()?;
    parse_price(info.key, info.owner, &data, now, ORACLE_MAX_AGE_SECS)
}

/// +1 / 0 / -1 depending on the price move since the bell, with a dead-band.
pub fn mood(snap: i64, now_price: Option<i64>) -> i8 {
    match now_price {
        Some(p) if snap > 0 => {
            let diff = (p as i128 - snap as i128) * 10_000;
            let band = snap as i128 * MOOD_DEADBAND_BPS;
            if diff > band {
                1
            } else if diff < -band {
                -1
            } else {
                0
            }
        }
        _ => 0,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SOL_USD_LIVE_HEX: &str = include_str!("../tests/sol_usd_live.hex");
    fn hex(s: &str) -> Vec<u8> {
        let s = s.trim();
        (0..s.len()).step_by(2).map(|i| u8::from_str_radix(&s[i..i + 2], 16).unwrap()).collect()
    }

    #[test]
    fn parses_live_sol_account_and_rejects_bad_input() {
        let data = hex(SOL_USD_LIVE_HEX);
        assert_eq!(data.len(), 134);
        let key: Pubkey = "ENYwebBThHzmzwPLAQvCucUTsjyfBSZdD9ViXksS4jPu".parse().unwrap();
        let publish = i64::from_le_bytes(data[93..101].try_into().unwrap());
        assert!(parse_price(&key, &ORACLE_PROGRAM_ID, &data, publish + 1, 10).is_some());
        assert!(parse_price(&key, &ORACLE_PROGRAM_ID, &data, publish + 11, 10).is_none(), "stale");
        assert!(parse_price(&key, &Pubkey::new_unique(), &data, publish, 10).is_none(), "wrong owner");
        assert!(parse_price(&Pubkey::new_unique(), &ORACLE_PROGRAM_ID, &data, publish, 10).is_none(), "wrong feed");
    }

    #[test]
    fn feed_pda_matches_documented_addresses() {
        let sol: Pubkey = "ENYwebBThHzmzwPLAQvCucUTsjyfBSZdD9ViXksS4jPu".parse().unwrap();
        let zec: Pubkey = "6XWQr2Y1XEpJrCdVbYGupnDeb3wkR4YXazVXdgn2Lwpg".parse().unwrap();
        assert_eq!(feed_pda(6), sol);
        assert_eq!(feed_pda(66), zec);
    }

    #[test]
    fn mood_deadband() {
        assert_eq!(mood(1_000_000, Some(1_000_050)), 0);
        assert_eq!(mood(1_000_000, Some(1_000_500)), 1);
        assert_eq!(mood(1_000_000, Some(999_000)), -1);
        assert_eq!(mood(0, Some(5)), 0);
        assert_eq!(mood(5, None), 0);
    }
}
