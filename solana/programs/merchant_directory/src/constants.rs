use anchor_lang::prelude::*;

#[constant]
pub const DIRECTORY_STATE_SEED: &[u8] = b"directory_state";

#[constant]
pub const MERCHANT_SEED: &[u8] = b"merchant";

/// Keep in sync with the `#[max_len(..)]` attributes on `Merchant` in state.rs.
pub const MAX_NAME_LEN: usize = 64;
pub const MAX_CATEGORY_LEN: usize = 32;
pub const MAX_ENDPOINT_URI_LEN: usize = 200;
