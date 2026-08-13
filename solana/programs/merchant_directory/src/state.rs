use anchor_lang::prelude::*;

/// Workspace singleton: who may list/activate merchants, and the next merchant id to hand out.
#[account]
#[derive(InitSpace)]
pub struct DirectoryState {
    pub authority: Pubkey,
    pub next_merchant_id: u64,
    pub bump: u8,
}

/// Thin local index of a merchant agent, one PDA per merchant id.
///
/// `agent_id` is a pointer into an external agent identity registry, if one
/// is ever wired up — this account is only a discovery index (endpoint,
/// geohash, category). Do not treat it as verified identity on its own.
#[account]
#[derive(InitSpace)]
pub struct Merchant {
    pub merchant_id: u64,
    pub agent_id: u64,
    #[max_len(64)]
    pub name: String,
    #[max_len(32)]
    pub category: String,
    #[max_len(200)]
    pub endpoint_uri: String,
    pub wallet: Pubkey,
    pub geo_hash: [u8; 32],
    pub active: bool,
    /// Off-chain attestation reference (e.g. an EAS-style UID), if any. Zeroed when absent.
    pub attestation_uid: [u8; 32],
    pub bump: u8,
}
