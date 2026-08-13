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

declare_id!("wRjcJxHLmDiStxUv5hhg4m3EZKnywZcBQj1W27unSHZ");

/// MerchantDirectory — thin local index of merchant agents.
///
/// This program is only a discovery index (endpoint URI, geohash, category).
/// It does not attempt to verify merchant identity on its own; if an
/// external agent identity/reputation registry is wired up later, treat
/// that registry as the source of truth and `agent_id` here as just a
/// pointer into it.
#[program]
pub mod merchant_directory {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        instructions::initialize::handle_initialize(ctx)
    }

    pub fn list_merchant(
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
        instructions::list_merchant::handle_list_merchant(
            ctx,
            merchant_id,
            agent_id,
            name,
            category,
            endpoint_uri,
            wallet,
            geo_hash,
            attestation_uid,
        )
    }

    pub fn set_active(ctx: Context<SetActive>, merchant_id: u64, active: bool) -> Result<()> {
        instructions::set_active::handle_set_active(ctx, merchant_id, active)
    }
}
