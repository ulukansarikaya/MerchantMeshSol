use anchor_lang::prelude::*;

#[event]
pub struct MerchantListed {
    pub merchant_id: u64,
    pub agent_id: u64,
    pub name: String,
    pub wallet: Pubkey,
}

#[event]
pub struct MerchantActiveSet {
    pub merchant_id: u64,
    pub active: bool,
}
