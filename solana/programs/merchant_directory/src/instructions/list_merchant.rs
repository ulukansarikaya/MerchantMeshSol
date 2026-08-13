use anchor_lang::prelude::*;

use crate::{constants::*, error::DirectoryError, events::MerchantListed, state::*};

#[derive(Accounts)]
#[instruction(merchant_id: u64)]
pub struct ListMerchant<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        mut,
        seeds = [DIRECTORY_STATE_SEED],
        bump = directory_state.bump,
        has_one = authority @ DirectoryError::Unauthorized,
    )]
    pub directory_state: Account<'info, DirectoryState>,
    #[account(
        init,
        payer = authority,
        space = 8 + Merchant::INIT_SPACE,
        seeds = [MERCHANT_SEED, merchant_id.to_le_bytes().as_ref()],
        bump
    )]
    pub merchant: Account<'info, Merchant>,
    pub system_program: Program<'info, System>,
}

/// Lists a new merchant. `merchant_id` must equal `directory_state.next_merchant_id` —
/// the caller reads that value off-chain first to derive the `merchant` PDA before
/// sending this instruction, and the program re-checks it here.
pub fn handle_list_merchant(
    ctx: Context<ListMerchant>,
    merchant_id: u64,
    agent_id: u64,
    name: String,
    category: String,
    endpoint_uri: String,
    wallet: Pubkey,
    geo_hash: [u8; 32],
    attestation_uid: [u8; 32],
) -> Result<()> {
    require!(name.len() <= MAX_NAME_LEN, DirectoryError::NameTooLong);
    require!(category.len() <= MAX_CATEGORY_LEN, DirectoryError::CategoryTooLong);
    require!(endpoint_uri.len() <= MAX_ENDPOINT_URI_LEN, DirectoryError::EndpointUriTooLong);

    let state = &mut ctx.accounts.directory_state;
    require_eq!(merchant_id, state.next_merchant_id, DirectoryError::MerchantIdMismatch);
    state.next_merchant_id = state
        .next_merchant_id
        .checked_add(1)
        .ok_or(DirectoryError::Overflow)?;

    let merchant = &mut ctx.accounts.merchant;
    merchant.merchant_id = merchant_id;
    merchant.agent_id = agent_id;
    merchant.name = name.clone();
    merchant.category = category;
    merchant.endpoint_uri = endpoint_uri;
    merchant.wallet = wallet;
    merchant.geo_hash = geo_hash;
    merchant.active = true;
    merchant.attestation_uid = attestation_uid;
    merchant.bump = ctx.bumps.merchant;

    emit!(MerchantListed { merchant_id, agent_id, name, wallet });
    Ok(())
}
