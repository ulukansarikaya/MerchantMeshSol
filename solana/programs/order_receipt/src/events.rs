use anchor_lang::prelude::*;

#[event]
pub struct ReceiptCreated {
    pub receipt_id: u64,
    pub task_ref: String,
    pub metadata_hash: [u8; 32],
}

#[event]
pub struct MicroSpendRecorded {
    pub receipt_id: u64,
    pub total_research_micro_usdc: u64,
}

#[event]
pub struct MainPaymentRecorded {
    pub receipt_id: u64,
    pub total_main_micro_usdc: u64,
    pub completed_items: u64,
    pub total_items: u64,
}

#[event]
pub struct OrderRefunded {
    pub receipt_id: u64,
    pub task_ref: String,
    pub refunded_micro_usdc: u64,
}
