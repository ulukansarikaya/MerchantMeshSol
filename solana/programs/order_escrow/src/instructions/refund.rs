use anchor_lang::prelude::*;
use anchor_spl::token::{close_account, transfer, CloseAccount, Token, TokenAccount, Transfer};

use crate::{constants::*, error::EscrowError, events::OrderRefunded, state::*};

#[derive(Accounts)]
#[instruction(order_id: u64)]
pub struct Refund<'info> {
    /// Anyone may call this once the deadline has passed; only the buyer may
    /// call it earlier (pre-Preparing cancel) — enforced in the handler.
    pub caller: Signer<'info>,
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
    /// CHECK: only used as a lamport destination, matched against order.buyer.
    #[account(mut, constraint = buyer.key() == order.buyer @ EscrowError::NotBuyer)]
    pub buyer: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token>,
}

pub fn handle_refund(ctx: Context<Refund>, order_id: u64) -> Result<()> {
    let order = &ctx.accounts.order;
    require!(
        order.state != OrderState::Released
            && order.state != OrderState::Refunded
            && order.state != OrderState::Disputed,
        EscrowError::WrongState
    );
    let buyer_cancel_pre_prep =
        ctx.accounts.caller.key() == order.buyer && order.state == OrderState::Funded;
    let past_deadline = Clock::get()?.unix_timestamp >= order.release_deadline;
    require!(buyer_cancel_pre_prep || past_deadline, EscrowError::RefundNotAllowed);

    let amount = order.amount;
    let bump = order.bump;
    let buyer_key = order.buyer;
    let order_id_bytes = order_id.to_le_bytes();
    let signer_seeds: &[&[u8]] = &[ORDER_SEED, order_id_bytes.as_ref(), &[bump]];

    transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            Transfer {
                from: ctx.accounts.vault.to_account_info(),
                to: ctx.accounts.buyer_token_account.to_account_info(),
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

    ctx.accounts.order.state = OrderState::Refunded;
    emit!(OrderRefunded { order_id, to: buyer_key, amount });
    Ok(())
}
