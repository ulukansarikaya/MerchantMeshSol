use anchor_lang::prelude::*;
use anchor_spl::token::{close_account, transfer, CloseAccount, Token, TokenAccount, Transfer};

use crate::{constants::*, error::EscrowError, events::OrderReleased, state::*};

/// Manual fallback release — buyer only. Labeled as a fallback in the UI;
/// the intended path is `confirm_pickup` (merchant enters the pickup code).
#[derive(Accounts)]
#[instruction(order_id: u64)]
pub struct UserRelease<'info> {
    #[account(constraint = buyer.key() == order.buyer @ EscrowError::NotBuyer)]
    pub buyer: Signer<'info>,
    #[account(mut, seeds = [ORDER_SEED, order_id.to_le_bytes().as_ref()], bump = order.bump)]
    pub order: Account<'info, Order>,
    #[account(mut, seeds = [VAULT_SEED, order_id.to_le_bytes().as_ref()], bump)]
    pub vault: Account<'info, TokenAccount>,
    #[account(
        seeds = [MERCHANT_WALLET_SEED, merchant_wallet.merchant_id.to_le_bytes().as_ref()],
        bump = merchant_wallet.bump,
    )]
    pub merchant_wallet: Account<'info, MerchantWallet>,
    #[account(
        mut,
        token::mint = vault.mint,
        constraint = merchant_token_account.owner == merchant_wallet.wallet @ EscrowError::WrongTokenAccountOwner,
    )]
    pub merchant_token_account: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

pub fn handle_user_release(ctx: Context<UserRelease>, order_id: u64) -> Result<()> {
    let order = &ctx.accounts.order;
    require!(
        order.state != OrderState::Released && order.state != OrderState::Refunded,
        EscrowError::WrongState
    );

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
