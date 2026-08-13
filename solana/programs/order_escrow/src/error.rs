use anchor_lang::prelude::*;

#[error_code]
pub enum EscrowError {
    #[msg("only the escrow authority can perform this action")]
    Unauthorized,
    #[msg("only the escrow arbiter can perform this action")]
    NotArbiter,
    #[msg("order_id does not match escrow_config.next_order_id")]
    OrderIdMismatch,
    #[msg("order id counter overflowed")]
    Overflow,
    #[msg("amount must be greater than zero")]
    ZeroAmount,
    #[msg("release_deadline must be in the future")]
    DeadlineInPast,
    #[msg("order is not in the required state for this action")]
    WrongState,
    #[msg("only the order's buyer can perform this action")]
    NotBuyer,
    #[msg("only the order's merchant wallet can perform this action")]
    NotMerchant,
    #[msg("pickup code does not match the stored hash")]
    WrongPickupCode,
    #[msg("refund is only allowed pre-Preparing (buyer) or past the release deadline (anyone)")]
    RefundNotAllowed,
    #[msg("destination token account owner does not match the expected wallet")]
    WrongTokenAccountOwner,
    #[msg("destination token account mint does not match the vault's mint")]
    WrongTokenAccountMint,
}
