use anchor_lang::prelude::*;
use anchor_spl::token::{close_account, transfer, CloseAccount, Token, TokenAccount, Transfer};

use crate::{constants::*, error::EscrowError, events::OrderReleased, state::*};

#[derive(Accounts)]
#[instruction(order_id: u64)]
pub struct ConfirmPickup<'info> {
    pub merchant: Signer<'info>,
    #[account(
        seeds = [MERCHANT_WALLET_SEED, merchant_wallet.merchant_id.to_le_bytes().as_ref()],
        bump = merchant_wallet.bump,
        constraint = merchant_wallet.wallet == merchant.key() @ EscrowError::NotMerchant,
    )]
    pub merchant_wallet: Account<'info, MerchantWallet>,
    #[account(mut, seeds = [ORDER_SEED, order_id.to_le_bytes().as_ref()], bump = order.bump)]
    pub order: Account<'info, Order>,
    #[account(mut, seeds = [VAULT_SEED, order_id.to_le_bytes().as_ref()], bump)]
    pub vault: Account<'info, TokenAccount>,
    #[account(
        mut,
        token::mint = vault.mint,
        constraint = merchant_token_account.owner == merchant_wallet.wallet @ EscrowError::WrongTokenAccountOwner,
    )]
    pub merchant_token_account: Account<'info, TokenAccount>,
    /// Order's buyer — receives the vault's reclaimed rent once it is closed.
    /// CHECK: only used as a lamport destination, matched against order.buyer.
    #[account(mut, constraint = buyer.key() == order.buyer @ EscrowError::NotBuyer)]
    pub buyer: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token>,
}

/// Merchant enters the buyer's one-time pickup code -> release to merchant.
pub fn handle_confirm_pickup(ctx: Context<ConfirmPickup>, order_id: u64, code: String) -> Result<()> {
    let order = &ctx.accounts.order;
    require!(
        order.state == OrderState::Ready || order.state == OrderState::Preparing,
        EscrowError::WrongState
    );
    let hash = solana_keccak_hasher::hash(code.as_bytes()).to_bytes();
    require!(hash == order.pickup_code_hash, EscrowError::WrongPickupCode);

    let amount = order.amount;
    let bump = order.bump;
    let order_id_bytes = order_id.to_le_bytes();
    let signer_seeds: &[&[u8]] = &[ORDER_SEED, order_id_bytes.as_ref(), &[bump]];

    transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            Transfer {
                from: ctx.accounts.vault.to_account_info(),
                to: ctx.accounts.merchant_token_account.to_account_info(),
                authority: ctx.accounts.order.to_account_info(),
            },
            &[signer_seeds],
        ),
        amount,
    )?;
    close_account(CpiContext::new_with_signer(
        ctx.accounts.token_program.key(),
        CloseAccount {
            account: ctx.accounts.vault.to_account_info(),
            destination: ctx.accounts.buyer.to_account_info(),
            authority: ctx.accounts.order.to_account_info(),
        },
        &[signer_seeds],
    ))?;

    ctx.accounts.order.state = OrderState::Released;
    emit!(OrderReleased {
        order_id,
        to: ctx.accounts.merchant_wallet.wallet,
        amount,
    });
    Ok(())
}
