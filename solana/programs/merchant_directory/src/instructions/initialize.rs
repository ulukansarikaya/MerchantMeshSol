use anchor_lang::prelude::*;

use crate::{constants::*, state::DirectoryState};

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        init,
        payer = authority,
        space = 8 + DirectoryState::INIT_SPACE,
        seeds = [DIRECTORY_STATE_SEED],
        bump
    )]
    pub directory_state: Account<'info, DirectoryState>,
    pub system_program: Program<'info, System>,
}

pub fn handle_initialize(ctx: Context<Initialize>) -> Result<()> {
    let state = &mut ctx.accounts.directory_state;
    state.authority = ctx.accounts.authority.key();
    state.next_merchant_id = 1;
    state.bump = ctx.bumps.directory_state;
    Ok(())
}
