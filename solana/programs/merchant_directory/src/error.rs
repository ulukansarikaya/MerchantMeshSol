use anchor_lang::prelude::*;

#[error_code]
pub enum DirectoryError {
    #[msg("Only the directory authority can perform this action")]
    Unauthorized,
    #[msg("merchant_id does not match the directory's next_merchant_id")]
    MerchantIdMismatch,
    #[msg("merchant id counter overflowed")]
    Overflow,
    #[msg("name exceeds the maximum length")]
    NameTooLong,
    #[msg("category exceeds the maximum length")]
    CategoryTooLong,
    #[msg("endpoint URI exceeds the maximum length")]
    EndpointUriTooLong,
}
