pub mod constants;
pub mod error;
pub mod events;
pub mod instructions;
pub mod state;

use anchor_lang::prelude::*;

pub use constants::*;
pub use events::*;
pub use instructions::*;
pub use state::*;

declare_id!("3M8mUguDLdnvPqvVE9KYp11MfkTcGYCo8UhnVqoCCCuV");

/// OrderEscrow — pickup-code released escrow for MerchantMesh orders.
///
/// The buyer's agent funds one escrow (a per-order SPL token vault PDA) per
/// merchant order. The merchant releases it by submitting the buyer's
/// one-time pickup code (`keccak256(code)` must match the stored hash).
/// Manual `user_release` exists only as a fallback; timeouts drive automatic
/// refunds via `refund`.
#[program]
pub mod order_escrow {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, arbiter: Pubkey, usdc_mint: Pubkey) -> Result<()> {
        instructions::initialize::handle_initialize(ctx, arbiter, usdc_mint)
    }

    pub fn set_merchant_wallet(ctx: Context<SetMerchantWallet>, merchant_id: u64, wallet: Pubkey) -> Result<()> {
        instructions::set_merchant_wallet::handle_set_merchant_wallet(ctx, merchant_id, wallet)
    }

    pub fn set_usdc_mint(ctx: Context<SetUsdcMint>) -> Result<()> {
        instructions::set_usdc_mint::handle_set_usdc_mint(ctx)
    }

    pub fn fund(
        ctx: Context<Fund>,
        order_id: u64,
        amount: u64,
        quote_hash: [u8; 32],
        pickup_code_hash: [u8; 32],
        release_deadline: i64,
    ) -> Result<()> {
        instructions::fund::handle_fund(ctx, order_id, amount, quote_hash, pickup_code_hash, release_deadline)
    }

    pub fn mark_preparing(ctx: Context<MarkPreparing>, order_id: u64) -> Result<()> {
        instructions::mark_preparing::handle_mark_preparing(ctx, order_id)
    }

    pub fn mark_ready(ctx: Context<MarkReady>, order_id: u64) -> Result<()> {
        instructions::mark_ready::handle_mark_ready(ctx, order_id)
    }

    pub fn confirm_pickup(ctx: Context<ConfirmPickup>, order_id: u64, code: String) -> Result<()> {
        instructions::confirm_pickup::handle_confirm_pickup(ctx, order_id, code)
    }

    pub fn refund(ctx: Context<Refund>, order_id: u64) -> Result<()> {
        instructions::refund::handle_refund(ctx, order_id)
    }

    pub fn user_release(ctx: Context<UserRelease>, order_id: u64) -> Result<()> {
        instructions::user_release::handle_user_release(ctx, order_id)
    }

    pub fn dispute(ctx: Context<Dispute>, order_id: u64) -> Result<()> {
        instructions::dispute::handle_dispute(ctx, order_id)
    }

    pub fn resolve(ctx: Context<Resolve>, order_id: u64, release_to_merchant: bool) -> Result<()> {
        instructions::resolve::handle_resolve(ctx, order_id, release_to_merchant)
    }
}
