use anchor_lang::prelude::*;

use crate::{constants::*, error::EscrowError, events::MerchantWalletSet, state::*};

#[derive(Accounts)]
#[instruction(merchant_id: u64)]
pub struct SetMerchantWallet<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        seeds = [ESCROW_CONFIG_SEED],
        bump = escrow_config.bump,
        has_one = authority @ EscrowError::Unauthorized,
    )]
    pub escrow_config: Account<'info, EscrowConfig>,
    #[account(
        init_if_needed,
        payer = authority,
        space = 8 + MerchantWallet::INIT_SPACE,
        seeds = [MERCHANT_WALLET_SEED, merchant_id.to_le_bytes().as_ref()],
        bump
    )]
    pub merchant_wallet: Account<'info, MerchantWallet>,
    pub system_program: Program<'info, System>,
}

/// Registers or updates a merchant's payout wallet. Admin-only, independent
/// of the MerchantDirectory program (mirrors OrderEscrow.sol's own mapping).
pub fn handle_set_merchant_wallet(ctx: Context<SetMerchantWallet>, merchant_id: u64, wallet: Pubkey) -> Result<()> {
    let merchant_wallet = &mut ctx.accounts.merchant_wallet;
    merchant_wallet.merchant_id = merchant_id;
    merchant_wallet.wallet = wallet;
    merchant_wallet.bump = ctx.bumps.merchant_wallet;
    emit!(MerchantWalletSet { merchant_id, wallet });
    Ok(())
}
