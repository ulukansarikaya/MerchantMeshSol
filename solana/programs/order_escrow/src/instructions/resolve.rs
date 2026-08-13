use anchor_lang::prelude::*;
use anchor_spl::token::{close_account, transfer, CloseAccount, Token, TokenAccount, Transfer};

use crate::{
    constants::*,
    error::EscrowError,
    events::{DisputeResolved, OrderRefunded, OrderReleased},
    state::*,
};

#[derive(Accounts)]
#[instruction(order_id: u64)]
pub struct Resolve<'info> {
    pub arbiter: Signer<'info>,
    #[account(
        seeds = [ESCROW_CONFIG_SEED],
        bump = escrow_config.bump,
        constraint = escrow_config.arbiter == arbiter.key() @ EscrowError::NotArbiter,
    )]
    pub escrow_config: Account<'info, EscrowConfig>,
    #[account(mut, seeds = [ORDER_SEED, order_id.to_le_bytes().as_ref()], bump = order.bump)]
    pub order: Account<'info, Order>,
    #[account(mut, seeds = [VAULT_SEED, order_id.to_le_bytes().as_ref()], bump)]
    pub vault: Account<'info, TokenAccount>,
    #[account(
        mut,
        token::mint = vault.mint,
        constraint = buyer_token_account.owner == order.buyer @ EscrowError::WrongTokenAccountOwner,
    )]
    pub buyer_token_account: Account<'info, TokenAccount>,
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
    /// CHECK: only used as a lamport destination for the closed vault, matched against order.buyer.
    #[account(mut, constraint = buyer.key() == order.buyer @ EscrowError::NotBuyer)]
    pub buyer: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token>,
}

/// Arbiter resolves a disputed order: `release_to_merchant == true` pays the
/// merchant, `false` refunds the buyer.
pub fn handle_resolve(ctx: Context<Resolve>, order_id: u64, release_to_merchant: bool) -> Result<()> {
    let order = &ctx.accounts.order;
    require_eq!(order.state, OrderState::Disputed, EscrowError::WrongState);

    let amount = order.amount;
    let bump = order.bump;
    let buyer_key = order.buyer;
    let order_id_bytes = order_id.to_le_bytes();
    let signer_seeds: &[&[u8]] = &[ORDER_SEED, order_id_bytes.as_ref(), &[bump]];

    let destination = if release_to_merchant {
        ctx.accounts.merchant_token_account.to_account_info()
    } else {
        ctx.accounts.buyer_token_account.to_account_info()
    };

    transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            Transfer {
                from: ctx.accounts.vault.to_account_info(),
                to: destination,
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

    if release_to_merchant {
        ctx.accounts.order.state = OrderState::Released;
        emit!(OrderReleased {
            order_id,
            to: ctx.accounts.merchant_wallet.wallet,
            amount,
        });
    } else {
        ctx.accounts.order.state = OrderState::Refunded;
        emit!(OrderRefunded { order_id, to: buyer_key, amount });
    }
    emit!(DisputeResolved { order_id, released_to_merchant: release_to_merchant });
    Ok(())
}
