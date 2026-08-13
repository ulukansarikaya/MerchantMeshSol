use anchor_lang::prelude::*;

/// Workspace singleton: admin authority, the relayer that writes receipts,
/// and the next receipt id to hand out.
#[account]
#[derive(InitSpace)]
pub struct ReceiptConfig {
    pub authority: Pubkey,
    pub relayer: Pubkey,
    pub next_receipt_id: u64,
    pub bump: u8,
}

/// Unified on-chain receipt for a shopping task, written by the relayer
/// after settlement: research micro-spend, main payment total,
/// completed/total items, and a hash of the off-chain receipt metadata.
#[account]
#[derive(InitSpace)]
pub struct Receipt {
    pub receipt_id: u64,
    #[max_len(64)]
    pub task_ref: String,
    pub total_research_micro_usdc: u64,
    pub total_main_micro_usdc: u64,
    pub completed_items: u64,
    pub total_items: u64,
    #[max_len(200)]
    pub metadata_uri: String,
    pub metadata_hash: [u8; 32],
    pub bump: u8,
}
