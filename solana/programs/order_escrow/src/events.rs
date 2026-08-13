use anchor_lang::prelude::*;

#[event]
pub struct MerchantWalletSet {
    pub merchant_id: u64,
    pub wallet: Pubkey,
}

#[event]
pub struct OrderFunded {
    pub order_id: u64,
    pub merchant_id: u64,
    pub buyer: Pubkey,
    pub amount: u64,
    pub quote_hash: [u8; 32],
}

#[event]
pub struct OrderPreparing {
    pub order_id: u64,
}

#[event]
pub struct OrderReady {
    pub order_id: u64,
}

#[event]
pub struct OrderReleased {
    pub order_id: u64,
    pub to: Pubkey,
    pub amount: u64,
}

#[event]
pub struct OrderRefunded {
    pub order_id: u64,
    pub to: Pubkey,
    pub amount: u64,
}

#[event]
pub struct OrderDisputed {
    pub order_id: u64,
    pub by: Pubkey,
}

#[event]
pub struct DisputeResolved {
    pub order_id: u64,
    pub released_to_merchant: bool,
}
