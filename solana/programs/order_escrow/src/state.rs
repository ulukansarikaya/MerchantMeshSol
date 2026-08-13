use anchor_lang::prelude::*;

#[derive(AnchorSerialize, AnchorDeserialize, InitSpace, Clone, Copy, PartialEq, Eq, Debug)]
pub enum OrderState {
    Funded,
    Preparing,
    Ready,
    Released,
    Refunded,
    Disputed,
}

impl std::fmt::Display for OrderState {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{:?}", self)
    }
}

/// Workspace singleton: admin authority, dispute arbiter, the USDC (or other
/// SPL) mint this escrow accepts, and the next order id to hand out.
#[account]
#[derive(InitSpace)]
pub struct EscrowConfig {
    pub authority: Pubkey,
    pub arbiter: Pubkey,
    pub usdc_mint: Pubkey,
    pub next_order_id: u64,
    pub bump: u8,
}

/// merchant_id -> payout wallet, set by the admin. Independent of the
/// MerchantDirectory program — this escrow does not read that directory,
/// exactly like the original OrderEscrow.sol kept its own wallet mapping.
#[account]
#[derive(InitSpace)]
pub struct MerchantWallet {
    pub merchant_id: u64,
    pub wallet: Pubkey,
    pub bump: u8,
}

/// One escrowed order. The vault (a separate token account PDA, seeds
/// [VAULT_SEED, order_id]) holds the funds; this account's own address is
/// the vault's token authority, so releases/refunds sign the outgoing
/// transfer with the order's own PDA seeds.
#[account]
#[derive(InitSpace)]
pub struct Order {
    pub order_id: u64,
    pub merchant_id: u64,
    pub buyer: Pubkey,
    pub amount: u64,
    /// Hash of the merchant's signed quote (opaque to this program).
    pub quote_hash: [u8; 32],
    /// keccak256(one-time pickup code); only the hash is ever stored on-chain.
    pub pickup_code_hash: [u8; 32],
    pub funded_at: i64,
    pub release_deadline: i64,
    pub state: OrderState,
    pub bump: u8,
}
