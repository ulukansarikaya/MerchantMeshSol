use anchor_lang::prelude::*;

use crate::{constants::*, error::EscrowError, events::OrderDisputed, state::*};

#[derive(Accounts)]
#[instruction(order_id: u64)]
pub struct Dispute<'info> {
    pub caller: Signer<'info>,
    #[account(mut, seeds = [ORDER_SEED, order_id.to_le_bytes().as_ref()], bump = order.bump)]
    pub order: Account<'info, Order>,
    #[account(
        seeds = [MERCHANT_WALLET_SEED, merchant_wallet.merchant_id.to_le_bytes().as_ref()],
        bump = merchant_wallet.bump,
    )]
    pub merchant_wallet: Account<'info, MerchantWallet>,
}

pub fn handle_dispute(ctx: Context<Dispute>, order_id: u64) -> Result<()> {
    let order = &mut ctx.accounts.order;
    let caller = ctx.accounts.caller.key();
    require!(
        caller == order.buyer || caller == ctx.accounts.merchant_wallet.wallet,
        EscrowError::Unauthorized
    );
    require!(
        order.state == OrderState::Funded
            || order.state == OrderState::Preparing
            || order.state == OrderState::Ready,
        EscrowError::WrongState
    );
    order.state = OrderState::Disputed;
    emit!(OrderDisputed { order_id, by: caller });
    Ok(())
}
