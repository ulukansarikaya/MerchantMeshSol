use anchor_lang::prelude::*;

use crate::{constants::*, error::DirectoryError, events::MerchantActiveSet, state::*};

#[derive(Accounts)]
#[instruction(merchant_id: u64)]
pub struct SetActive<'info> {
    pub authority: Signer<'info>,
    #[account(
        seeds = [DIRECTORY_STATE_SEED],
        bump = directory_state.bump,
        has_one = authority @ DirectoryError::Unauthorized,
    )]
    pub directory_state: Account<'info, DirectoryState>,
    #[account(
        mut,
        seeds = [MERCHANT_SEED, merchant_id.to_le_bytes().as_ref()],
        bump = merchant.bump,
    )]
    pub merchant: Account<'info, Merchant>,
}

pub fn handle_set_active(ctx: Context<SetActive>, merchant_id: u64, active: bool) -> Result<()> {
    ctx.accounts.merchant.active = active;
    emit!(MerchantActiveSet { merchant_id, active });
    Ok(())
}
