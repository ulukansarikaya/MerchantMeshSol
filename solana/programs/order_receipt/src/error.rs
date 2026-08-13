use anchor_lang::prelude::*;

#[error_code]
pub enum ReceiptError {
    #[msg("only the receipt relayer can perform this action")]
    Unauthorized,
    #[msg("receipt_id does not match receipt_config.next_receipt_id")]
    ReceiptIdMismatch,
    #[msg("receipt id counter overflowed")]
    Overflow,
    #[msg("task_ref exceeds the maximum length")]
    TaskRefTooLong,
    #[msg("metadata_uri exceeds the maximum length")]
    MetadataUriTooLong,
}
