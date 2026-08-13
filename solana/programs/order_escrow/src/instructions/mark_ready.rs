use anchor_lang::prelude::*;

use crate::{constants::*, error::EscrowError, events::OrderReady, state::*};

#[derive(Accounts)]
#[instruction(order_id: u64)]
pub struct MarkReady<'info> {
    pub merchant: Signer<'info>,
    #[account(
        seeds = [MERCHANT_WALLET_SEED, merchant_wallet.merchant_id.to_le_bytes().as_ref()],
        bump = merchant_wallet.bump,
        constraint = merchant_wallet.wallet == merchant.key() @ EscrowError::NotMerchant,
    )]
    pub merchant_wallet: Account<'info, MerchantWallet>,
    #[account(mut, seeds = [ORDER_SEED, order_id.to_le_bytes().as_ref()], bump = order.bump)]
    pub order: Account<'info, Order>,
}

pub fn handle_mark_ready(ctx: Context<MarkReady>, order_id: u64) -> Result<()> {
    let order = &mut ctx.accounts.order;
    require_eq!(order.state, OrderState::Preparing, EscrowError::WrongState);
    order.state = OrderState::Ready;
    emit!(OrderReady { order_id });
    Ok(())
}
