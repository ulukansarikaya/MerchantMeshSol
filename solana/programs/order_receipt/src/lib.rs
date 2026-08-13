pub mod constants;
pub mod error;
pub mod events;
pub mod instructions;
pub mod state;

use anchor_lang::prelude::*;

pub use constants::*;
pub use events::*;
pub use instructions::*;
pub use state::*;

declare_id!("B5htcm88nzRtNyfHMyhh7SQ5pHudw1dMx6Ean5xP2wsm");

/// OrderReceipt — unified on-chain receipt for a shopping task.
///
/// Written by the relayer after settlement: research micro-spend, main
/// payment total, completed/total items, and a hash of the off-chain
/// receipt metadata.
#[program]
pub mod order_receipt {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, relayer: Pubkey) -> Result<()> {
        instructions::initialize::handle_initialize(ctx, relayer)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn create_receipt(
        ctx: Context<CreateReceipt>,
        receipt_id: u64,
        task_ref: String,
        total_research_micro_usdc: u64,
        total_main_micro_usdc: u64,
        completed_items: u64,
        total_items: u64,
        metadata_uri: String,
        metadata_hash: [u8; 32],
    ) -> Result<()> {
        instructions::create_receipt::handle_create_receipt(
            ctx,
            receipt_id,
            task_ref,
            total_research_micro_usdc,
            total_main_micro_usdc,
            completed_items,
            total_items,
            metadata_uri,
            metadata_hash,
        )
    }

    pub fn record_refund(ctx: Context<RecordRefund>, receipt_id: u64, refunded_micro_usdc: u64) -> Result<()> {
        instructions::record_refund::handle_record_refund(ctx, receipt_id, refunded_micro_usdc)
    }
}
