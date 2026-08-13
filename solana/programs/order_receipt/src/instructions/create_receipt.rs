use anchor_lang::prelude::*;

use crate::{
    constants::*,
    error::ReceiptError,
    events::{MainPaymentRecorded, MicroSpendRecorded, ReceiptCreated},
    state::*,
};

#[derive(Accounts)]
#[instruction(receipt_id: u64)]
pub struct CreateReceipt<'info> {
    #[account(mut)]
    pub relayer: Signer<'info>,
    #[account(
        mut,
        seeds = [RECEIPT_CONFIG_SEED],
        bump = receipt_config.bump,
        constraint = receipt_config.relayer == relayer.key() @ ReceiptError::Unauthorized,
    )]
    pub receipt_config: Account<'info, ReceiptConfig>,
    #[account(
        init,
        payer = relayer,
        space = 8 + Receipt::INIT_SPACE,
        seeds = [RECEIPT_SEED, receipt_id.to_le_bytes().as_ref()],
        bump
    )]
    pub receipt: Account<'info, Receipt>,
    pub system_program: Program<'info, System>,
}

/// `receipt_id` must equal `receipt_config.next_receipt_id` (read off-chain
/// by the caller to derive the `receipt` PDA beforehand).
pub fn handle_create_receipt(
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
    require!(task_ref.len() <= MAX_TASK_REF_LEN, ReceiptError::TaskRefTooLong);
    require!(metadata_uri.len() <= MAX_METADATA_URI_LEN, ReceiptError::MetadataUriTooLong);

    let config = &mut ctx.accounts.receipt_config;
    require_eq!(receipt_id, config.next_receipt_id, ReceiptError::ReceiptIdMismatch);
    config.next_receipt_id = config.next_receipt_id.checked_add(1).ok_or(ReceiptError::Overflow)?;

    let receipt = &mut ctx.accounts.receipt;
    receipt.receipt_id = receipt_id;
    receipt.task_ref = task_ref.clone();
    receipt.total_research_micro_usdc = total_research_micro_usdc;
    receipt.total_main_micro_usdc = total_main_micro_usdc;
    receipt.completed_items = completed_items;
    receipt.total_items = total_items;
    receipt.metadata_uri = metadata_uri;
    receipt.metadata_hash = metadata_hash;
    receipt.bump = ctx.bumps.receipt;

    emit!(ReceiptCreated { receipt_id, task_ref, metadata_hash });
    emit!(MicroSpendRecorded { receipt_id, total_research_micro_usdc });
    emit!(MainPaymentRecorded { receipt_id, total_main_micro_usdc, completed_items, total_items });
    Ok(())
}
