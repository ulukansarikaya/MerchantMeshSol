use anchor_lang::prelude::*;
use anchor_spl::token::Mint;

use crate::{constants::*, error::EscrowError, state::*};

#[derive(Accounts)]
pub struct SetUsdcMint<'info> {
    pub authority: Signer<'info>,
    #[account(
        mut,
        seeds = [ESCROW_CONFIG_SEED],
        bump = escrow_config.bump,
        has_one = authority @ EscrowError::Unauthorized,
    )]
    pub escrow_config: Account<'info, EscrowConfig>,
    /// Requiring a decoded SPL Mint prevents configuring an arbitrary address.
    pub usdc_mint: Account<'info, Mint>,
}

/// Changes the accepted mint for future escrow funding. Existing order vaults
/// retain their own mint and remain independently releasable/refundable.
pub fn handle_set_usdc_mint(ctx: Context<SetUsdcMint>) -> Result<()> {
    ctx.accounts.escrow_config.usdc_mint = ctx.accounts.usdc_mint.key();
    Ok(())
}
