use anchor_lang::prelude::*;

use crate::{constants::*, error::ReceiptError, events::OrderRefunded, state::*};

#[derive(Accounts)]
#[instruction(receipt_id: u64)]
pub struct RecordRefund<'info> {
    pub relayer: Signer<'info>,
    #[account(
        seeds = [RECEIPT_CONFIG_SEED],
        bump = receipt_config.bump,
        constraint = receipt_config.relayer == relayer.key() @ ReceiptError::Unauthorized,
    )]
    pub receipt_config: Account<'info, ReceiptConfig>,
    #[account(seeds = [RECEIPT_SEED, receipt_id.to_le_bytes().as_ref()], bump = receipt.bump)]
    pub receipt: Account<'info, Receipt>,
}

/// Event-only, like OrderReceipt.sol's `recordRefund` — no on-chain state
/// besides the receipt's existence is mutated.
pub fn handle_record_refund(ctx: Context<RecordRefund>, receipt_id: u64, refunded_micro_usdc: u64) -> Result<()> {
    emit!(OrderRefunded {
        receipt_id,
        task_ref: ctx.accounts.receipt.task_ref.clone(),
        refunded_micro_usdc,
    });
    Ok(())
}
