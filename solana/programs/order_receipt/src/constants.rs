use anchor_lang::prelude::*;

#[constant]
pub const RECEIPT_CONFIG_SEED: &[u8] = b"receipt_config";

#[constant]
pub const RECEIPT_SEED: &[u8] = b"receipt";

/// Keep in sync with the `#[max_len(..)]` attributes on `Receipt` in state.rs.
pub const MAX_TASK_REF_LEN: usize = 64;
pub const MAX_METADATA_URI_LEN: usize = 200;
