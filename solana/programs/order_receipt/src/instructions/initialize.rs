use anchor_lang::prelude::*;

use crate::{constants::*, state::ReceiptConfig};

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        init,
        payer = authority,
        space = 8 + ReceiptConfig::INIT_SPACE,
        seeds = [RECEIPT_CONFIG_SEED],
        bump
    )]
    pub receipt_config: Account<'info, ReceiptConfig>,
    pub system_program: Program<'info, System>,
}

pub fn handle_initialize(ctx: Context<Initialize>, relayer: Pubkey) -> Result<()> {
    let config = &mut ctx.accounts.receipt_config;
    config.authority = ctx.accounts.authority.key();
    config.relayer = relayer;
    config.next_receipt_id = 1;
    config.bump = ctx.bumps.receipt_config;
    Ok(())
}
