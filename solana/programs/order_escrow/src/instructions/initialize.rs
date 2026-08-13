use anchor_lang::prelude::*;

use crate::{constants::*, state::EscrowConfig};

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        init,
        payer = authority,
        space = 8 + EscrowConfig::INIT_SPACE,
        seeds = [ESCROW_CONFIG_SEED],
        bump
    )]
    pub escrow_config: Account<'info, EscrowConfig>,
    pub system_program: Program<'info, System>,
}

/// `arbiter` resolves disputes (see `resolve`); in an MVP deployment this is
/// often the same key as `authority`, but the roles are stored separately.
pub fn handle_initialize(ctx: Context<Initialize>, arbiter: Pubkey, usdc_mint: Pubkey) -> Result<()> {
    let config = &mut ctx.accounts.escrow_config;
    config.authority = ctx.accounts.authority.key();
    config.arbiter = arbiter;
    config.usdc_mint = usdc_mint;
    config.next_order_id = 1;
    config.bump = ctx.bumps.escrow_config;
    Ok(())
}
