use anchor_lang::prelude::*;
use anchor_spl::token::{transfer, Mint, Token, TokenAccount, Transfer};

use crate::{constants::*, error::EscrowError, events::OrderFunded, state::*};

#[derive(Accounts)]
#[instruction(order_id: u64)]
pub struct Fund<'info> {
    #[account(mut)]
    pub buyer: Signer<'info>,
    #[account(mut, seeds = [ESCROW_CONFIG_SEED], bump = escrow_config.bump)]
    pub escrow_config: Account<'info, EscrowConfig>,
    /// Existence of this PDA is the "merchant is registered" gate — mirrors
    /// OrderEscrow.sol's `merchantWallets[merchantId] != address(0)` check.
    #[account(
        seeds = [MERCHANT_WALLET_SEED, merchant_wallet.merchant_id.to_le_bytes().as_ref()],
        bump = merchant_wallet.bump,
    )]
    pub merchant_wallet: Account<'info, MerchantWallet>,
    #[account(
        init,
        payer = buyer,
        space = 8 + Order::INIT_SPACE,
        seeds = [ORDER_SEED, order_id.to_le_bytes().as_ref()],
        bump
    )]
    pub order: Account<'info, Order>,
    #[account(address = escrow_config.usdc_mint)]
    pub usdc_mint: Account<'info, Mint>,
    #[account(
        init,
        payer = buyer,
        token::mint = usdc_mint,
        token::authority = order,
        seeds = [VAULT_SEED, order_id.to_le_bytes().as_ref()],
        bump
    )]
    pub vault: Account<'info, TokenAccount>,
    #[account(
        mut,
        token::mint = usdc_mint,
        token::authority = buyer,
    )]
    pub buyer_token_account: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

/// Funds a new escrowed order. `order_id` must equal `escrow_config.next_order_id`
/// (read off-chain by the caller to derive the `order`/`vault` PDAs beforehand).
pub fn handle_fund(
    ctx: Context<Fund>,
    order_id: u64,
    amount: u64,
    quote_hash: [u8; 32],
    pickup_code_hash: [u8; 32],
    release_deadline: i64,
) -> Result<()> {
    require!(amount > 0, EscrowError::ZeroAmount);
    require!(
        release_deadline > Clock::get()?.unix_timestamp,
        EscrowError::DeadlineInPast
    );

    let config = &mut ctx.accounts.escrow_config;
    require_eq!(order_id, config.next_order_id, EscrowError::OrderIdMismatch);
    config.next_order_id = config.next_order_id.checked_add(1).ok_or(EscrowError::Overflow)?;

    let order = &mut ctx.accounts.order;
    order.order_id = order_id;
    order.merchant_id = ctx.accounts.merchant_wallet.merchant_id;
    order.buyer = ctx.accounts.buyer.key();
    order.amount = amount;
    order.quote_hash = quote_hash;
    order.pickup_code_hash = pickup_code_hash;
    order.funded_at = Clock::get()?.unix_timestamp;
    order.release_deadline = release_deadline;
    order.state = OrderState::Funded;
    order.bump = ctx.bumps.order;

    transfer(
        CpiContext::new(
            ctx.accounts.token_program.key(),
            Transfer {
                from: ctx.accounts.buyer_token_account.to_account_info(),
                to: ctx.accounts.vault.to_account_info(),
                authority: ctx.accounts.buyer.to_account_info(),
            },
        ),
        amount,
    )?;

    emit!(OrderFunded {
        order_id,
        merchant_id: order.merchant_id,
        buyer: order.buyer,
        amount,
        quote_hash,
    });
    Ok(())
}
