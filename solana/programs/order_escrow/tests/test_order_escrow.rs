use {
    anchor_lang::{
        prelude::Pubkey,
        solana_program::{clock::Clock, instruction::Instruction, system_instruction, system_program},
        AccountDeserialize, InstructionData, ToAccountMetas,
    },
    anchor_spl::token::spl_token,
    litesvm::LiteSVM,
    order_escrow::state::{Order, OrderState},
    sha3::{Digest, Keccak256},
    solana_keypair::Keypair,
    solana_message::{Message, VersionedMessage},
    solana_program_pack::Pack,
    solana_signer::Signer,
    solana_transaction::versioned::VersionedTransaction,
};

fn program_bytes() -> &'static [u8] {
    include_bytes!(concat!(env!("CARGO_TARGET_TMPDIR"), "/../deploy/order_escrow.so"))
}

fn keccak(code: &str) -> [u8; 32] {
    let mut hasher = Keccak256::new();
    hasher.update(code.as_bytes());
    hasher.finalize().into()
}

fn send(svm: &mut LiteSVM, payer: &Keypair, extra_signers: &[&Keypair], ix: Vec<Instruction>) -> litesvm::types::TransactionResult {
    let blockhash = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&ix, Some(&payer.pubkey()), &blockhash);
    let mut signers: Vec<&Keypair> = vec![payer];
    signers.extend(extra_signers);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &signers).unwrap();
    svm.send_transaction(tx)
}

fn token_balance(svm: &LiteSVM, token_account: &Pubkey) -> u64 {
    let account = svm.get_account(token_account).expect("token account should exist");
    spl_token::state::Account::unpack(&account.data).unwrap().amount
}

struct Setup {
    svm: LiteSVM,
    program_id: Pubkey,
    authority: Keypair,
    arbiter: Keypair,
    buyer: Keypair,
    merchant: Keypair,
    mint: Pubkey,
    escrow_config: Pubkey,
    merchant_wallet: Pubkey,
    buyer_token: Pubkey,
    merchant_token: Pubkey,
}

const MERCHANT_ID: u64 = 1;
const BUYER_INITIAL_USDC: u64 = 50_000_000; // 50 USDC (6 decimals)
const ORDER_AMOUNT: u64 = 10_000_000; // 10 USDC

fn setup() -> Setup {
    let program_id = order_escrow::id();
    let authority = Keypair::new();
    let arbiter = Keypair::new();
    let buyer = Keypair::new();
    let merchant = Keypair::new();
    let mint_authority = Keypair::new();

    let mut svm = LiteSVM::new().with_default_programs();
    svm.add_program(program_id, program_bytes()).unwrap();
    for kp in [&authority, &arbiter, &buyer, &merchant, &mint_authority] {
        svm.airdrop(&kp.pubkey(), 10_000_000_000).unwrap();
    }

    // --- create the USDC-like SPL mint (6 decimals) ---
    let mint_kp = Keypair::new();
    let mint_len = spl_token::state::Mint::LEN as u64;
    let mint_rent = svm.minimum_balance_for_rent_exemption(mint_len as usize);
    let create_mint_ix = system_instruction::create_account(
        &authority.pubkey(),
        &mint_kp.pubkey(),
        mint_rent,
        mint_len,
        &spl_token::ID,
    );
    let init_mint_ix = spl_token::instruction::initialize_mint2(
        &spl_token::ID,
        &mint_kp.pubkey(),
        &mint_authority.pubkey(),
        None,
        6,
    )
    .unwrap();
    send(&mut svm, &authority, &[&mint_kp], vec![create_mint_ix, init_mint_ix]).expect("mint init should succeed");

    // --- buyer's and merchant's plain SPL token accounts (not derived ATAs) ---
    let account_len = spl_token::state::Account::LEN as u64;
    let account_rent = svm.minimum_balance_for_rent_exemption(account_len as usize);

    let buyer_token_kp = Keypair::new();
    let create_buyer_token_ix = system_instruction::create_account(
        &authority.pubkey(),
        &buyer_token_kp.pubkey(),
        account_rent,
        account_len,
        &spl_token::ID,
    );
    let init_buyer_token_ix = spl_token::instruction::initialize_account3(
        &spl_token::ID,
        &buyer_token_kp.pubkey(),
        &mint_kp.pubkey(),
        &buyer.pubkey(),
    )
    .unwrap();
    let mint_to_buyer_ix = spl_token::instruction::mint_to(
        &spl_token::ID,
        &mint_kp.pubkey(),
        &buyer_token_kp.pubkey(),
        &mint_authority.pubkey(),
        &[],
        BUYER_INITIAL_USDC,
    )
    .unwrap();
    send(
        &mut svm,
        &authority,
        &[&buyer_token_kp, &mint_authority],
        vec![create_buyer_token_ix, init_buyer_token_ix, mint_to_buyer_ix],
    )
    .expect("buyer token account setup should succeed");

    let merchant_token_kp = Keypair::new();
    let create_merchant_token_ix = system_instruction::create_account(
        &authority.pubkey(),
        &merchant_token_kp.pubkey(),
        account_rent,
        account_len,
        &spl_token::ID,
    );
    let init_merchant_token_ix = spl_token::instruction::initialize_account3(
        &spl_token::ID,
        &merchant_token_kp.pubkey(),
        &mint_kp.pubkey(),
        &merchant.pubkey(),
    )
    .unwrap();
    send(
        &mut svm,
        &authority,
        &[&merchant_token_kp],
        vec![create_merchant_token_ix, init_merchant_token_ix],
    )
    .expect("merchant token account setup should succeed");

    // --- initialize the escrow program ---
    let escrow_config = Pubkey::find_program_address(&[b"escrow_config"], &program_id).0;
    let init_ix = Instruction::new_with_bytes(
        program_id,
        &order_escrow::instruction::Initialize { arbiter: arbiter.pubkey(), usdc_mint: mint_kp.pubkey() }.data(),
        order_escrow::accounts::Initialize {
            authority: authority.pubkey(),
            escrow_config,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    );
    send(&mut svm, &authority, &[], vec![init_ix]).expect("escrow initialize should succeed");

    let merchant_wallet = Pubkey::find_program_address(&[b"merchant_wallet", &MERCHANT_ID.to_le_bytes()], &program_id).0;
    let set_wallet_ix = Instruction::new_with_bytes(
        program_id,
        &order_escrow::instruction::SetMerchantWallet { merchant_id: MERCHANT_ID, wallet: merchant.pubkey() }.data(),
        order_escrow::accounts::SetMerchantWallet {
            authority: authority.pubkey(),
            escrow_config,
            merchant_wallet,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    );
    send(&mut svm, &authority, &[], vec![set_wallet_ix]).expect("set_merchant_wallet should succeed");

    Setup {
        svm,
        program_id,
        authority,
        arbiter,
        buyer,
        merchant,
        mint: mint_kp.pubkey(),
        escrow_config,
        merchant_wallet,
        buyer_token: buyer_token_kp.pubkey(),
        merchant_token: merchant_token_kp.pubkey(),
    }
}

struct FundedOrder {
    order_id: u64,
    order: Pubkey,
    vault: Pubkey,
    pickup_code: String,
}

fn fund_order(s: &mut Setup, order_id: u64, deadline_offset_secs: i64) -> FundedOrder {
    let order = Pubkey::find_program_address(&[b"order", &order_id.to_le_bytes()], &s.program_id).0;
    let vault = Pubkey::find_program_address(&[b"vault", &order_id.to_le_bytes()], &s.program_id).0;
    let pickup_code = "123456".to_string();
    let now = s.svm.get_sysvar::<Clock>().unix_timestamp;

    let ix = Instruction::new_with_bytes(
        s.program_id,
        &order_escrow::instruction::Fund {
            order_id,
            amount: ORDER_AMOUNT,
            quote_hash: [1u8; 32],
            pickup_code_hash: keccak(&pickup_code),
            release_deadline: now + deadline_offset_secs,
        }
        .data(),
        order_escrow::accounts::Fund {
            buyer: s.buyer.pubkey(),
            escrow_config: s.escrow_config,
            merchant_wallet: s.merchant_wallet,
            order,
            usdc_mint: s.mint,
            vault,
            buyer_token_account: s.buyer_token,
            token_program: spl_token::ID,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    );
    let buyer = s.buyer.insecure_clone();
    send(&mut s.svm, &buyer, &[], vec![ix]).expect("fund should succeed");

    FundedOrder { order_id, order, vault, pickup_code }
}

fn order_state(svm: &LiteSVM, order: &Pubkey) -> OrderState {
    let account = svm.get_account(order).unwrap();
    let mut data: &[u8] = &account.data;
    Order::try_deserialize(&mut data).unwrap().state
}

#[test]
fn fund_then_confirm_pickup_releases_to_merchant() {
    let mut s = setup();
    let f = fund_order(&mut s, 1, 3600);
    assert_eq!(token_balance(&s.svm, &f.vault), ORDER_AMOUNT);
    assert_eq!(token_balance(&s.svm, &s.buyer_token), BUYER_INITIAL_USDC - ORDER_AMOUNT);

    let merchant = s.merchant.insecure_clone();
    let prep_ix = Instruction::new_with_bytes(
        s.program_id,
        &order_escrow::instruction::MarkPreparing { order_id: f.order_id }.data(),
        order_escrow::accounts::MarkPreparing { merchant: merchant.pubkey(), merchant_wallet: s.merchant_wallet, order: f.order }
            .to_account_metas(None),
    );
    send(&mut s.svm, &merchant, &[], vec![prep_ix]).expect("mark_preparing should succeed");
    assert_eq!(order_state(&s.svm, &f.order), OrderState::Preparing);

    let ready_ix = Instruction::new_with_bytes(
        s.program_id,
        &order_escrow::instruction::MarkReady { order_id: f.order_id }.data(),
        order_escrow::accounts::MarkReady { merchant: merchant.pubkey(), merchant_wallet: s.merchant_wallet, order: f.order }
            .to_account_metas(None),
    );
    send(&mut s.svm, &merchant, &[], vec![ready_ix]).expect("mark_ready should succeed");
    assert_eq!(order_state(&s.svm, &f.order), OrderState::Ready);

    let confirm_ix = Instruction::new_with_bytes(
        s.program_id,
        &order_escrow::instruction::ConfirmPickup { order_id: f.order_id, code: f.pickup_code.clone() }.data(),
        order_escrow::accounts::ConfirmPickup {
            merchant: merchant.pubkey(),
            merchant_wallet: s.merchant_wallet,
            order: f.order,
            vault: f.vault,
            merchant_token_account: s.merchant_token,
            buyer: s.buyer.pubkey(),
            token_program: spl_token::ID,
        }
        .to_account_metas(None),
    );
    send(&mut s.svm, &merchant, &[], vec![confirm_ix]).expect("confirm_pickup should succeed");

    assert_eq!(order_state(&s.svm, &f.order), OrderState::Released);
    assert_eq!(token_balance(&s.svm, &s.merchant_token), ORDER_AMOUNT);
    assert!(s.svm.get_account(&f.vault).is_none(), "vault should be closed");
}

#[test]
fn confirm_pickup_rejects_wrong_code() {
    let mut s = setup();
    let f = fund_order(&mut s, 1, 3600);
    let merchant = s.merchant.insecure_clone();

    let confirm_ix = Instruction::new_with_bytes(
        s.program_id,
        &order_escrow::instruction::ConfirmPickup { order_id: f.order_id, code: "000000".to_string() }.data(),
        order_escrow::accounts::ConfirmPickup {
            merchant: merchant.pubkey(),
            merchant_wallet: s.merchant_wallet,
            order: f.order,
            vault: f.vault,
            merchant_token_account: s.merchant_token,
            buyer: s.buyer.pubkey(),
            token_program: spl_token::ID,
        }
        .to_account_metas(None),
    );
    let res = send(&mut s.svm, &merchant, &[], vec![confirm_ix]);
    assert!(res.is_err(), "expected WrongPickupCode rejection");
    assert_eq!(token_balance(&s.svm, &f.vault), ORDER_AMOUNT, "funds must stay in the vault");
}

#[test]
fn mark_preparing_rejects_non_merchant() {
    let mut s = setup();
    let f = fund_order(&mut s, 1, 3600);
    let attacker = Keypair::new();
    s.svm.airdrop(&attacker.pubkey(), 10_000_000_000).unwrap();

    let ix = Instruction::new_with_bytes(
        s.program_id,
        &order_escrow::instruction::MarkPreparing { order_id: f.order_id }.data(),
        order_escrow::accounts::MarkPreparing { merchant: attacker.pubkey(), merchant_wallet: s.merchant_wallet, order: f.order }
            .to_account_metas(None),
    );
    let res = send(&mut s.svm, &attacker, &[], vec![ix]);
    assert!(res.is_err(), "expected NotMerchant rejection");
}

fn refund_ix(s: &Setup, order: Pubkey, vault: Pubkey, caller: Pubkey) -> Instruction {
    Instruction::new_with_bytes(
        s.program_id,
        &order_escrow::instruction::Refund { order_id: 1 }.data(),
        order_escrow::accounts::Refund {
            caller,
            order,
            vault,
            buyer_token_account: s.buyer_token,
            buyer: s.buyer.pubkey(),
            token_program: spl_token::ID,
        }
        .to_account_metas(None),
    )
}

#[test]
fn refund_buyer_cancel_pre_preparing_succeeds() {
    let mut s = setup();
    let f = fund_order(&mut s, 1, 3600);
    let buyer = s.buyer.insecure_clone();
    let ix = refund_ix(&s, f.order, f.vault, buyer.pubkey());
    send(&mut s.svm, &buyer, &[], vec![ix]).expect("buyer refund pre-Preparing should succeed");

    assert_eq!(order_state(&s.svm, &f.order), OrderState::Refunded);
    assert_eq!(token_balance(&s.svm, &s.buyer_token), BUYER_INITIAL_USDC);
    assert!(s.svm.get_account(&f.vault).is_none(), "vault should be closed");
}

#[test]
fn refund_rejects_non_buyer_before_deadline() {
    let mut s = setup();
    let f = fund_order(&mut s, 1, 3600);
    let stranger = Keypair::new();
    s.svm.airdrop(&stranger.pubkey(), 10_000_000_000).unwrap();

    let ix = refund_ix(&s, f.order, f.vault, stranger.pubkey());
    let res = send(&mut s.svm, &stranger, &[], vec![ix]);
    assert!(res.is_err(), "expected RefundNotAllowed rejection");
}

#[test]
fn refund_after_deadline_succeeds_for_anyone() {
    let mut s = setup();
    let f = fund_order(&mut s, 1, 5);

    let mut clock = s.svm.get_sysvar::<Clock>();
    clock.unix_timestamp += 3600;
    s.svm.set_sysvar(&clock);

    let stranger = Keypair::new();
    s.svm.airdrop(&stranger.pubkey(), 10_000_000_000).unwrap();
    let ix = refund_ix(&s, f.order, f.vault, stranger.pubkey());
    send(&mut s.svm, &stranger, &[], vec![ix]).expect("refund past deadline should succeed for anyone");

    assert_eq!(order_state(&s.svm, &f.order), OrderState::Refunded);
    assert_eq!(token_balance(&s.svm, &s.buyer_token), BUYER_INITIAL_USDC);
}

#[test]
fn dispute_then_resolve_to_merchant() {
    let mut s = setup();
    let f = fund_order(&mut s, 1, 3600);
    let buyer = s.buyer.insecure_clone();

    let dispute_ix = Instruction::new_with_bytes(
        s.program_id,
        &order_escrow::instruction::Dispute { order_id: f.order_id }.data(),
        order_escrow::accounts::Dispute { caller: buyer.pubkey(), order: f.order, merchant_wallet: s.merchant_wallet }
            .to_account_metas(None),
    );
    send(&mut s.svm, &buyer, &[], vec![dispute_ix]).expect("dispute should succeed");
    assert_eq!(order_state(&s.svm, &f.order), OrderState::Disputed);

    let arbiter = s.arbiter.insecure_clone();
    let resolve_ix = Instruction::new_with_bytes(
        s.program_id,
        &order_escrow::instruction::Resolve { order_id: f.order_id, release_to_merchant: true }.data(),
        order_escrow::accounts::Resolve {
            arbiter: arbiter.pubkey(),
            escrow_config: s.escrow_config,
            order: f.order,
            vault: f.vault,
            buyer_token_account: s.buyer_token,
            merchant_wallet: s.merchant_wallet,
            merchant_token_account: s.merchant_token,
            buyer: s.buyer.pubkey(),
            token_program: spl_token::ID,
        }
        .to_account_metas(None),
    );
    send(&mut s.svm, &arbiter, &[], vec![resolve_ix]).expect("resolve(true) should succeed");

    assert_eq!(order_state(&s.svm, &f.order), OrderState::Released);
    assert_eq!(token_balance(&s.svm, &s.merchant_token), ORDER_AMOUNT);
}

#[test]
fn dispute_then_resolve_to_buyer() {
    let mut s = setup();
    let f = fund_order(&mut s, 1, 3600);
    let merchant = s.merchant.insecure_clone();

    let dispute_ix = Instruction::new_with_bytes(
        s.program_id,
        &order_escrow::instruction::Dispute { order_id: f.order_id }.data(),
        order_escrow::accounts::Dispute { caller: merchant.pubkey(), order: f.order, merchant_wallet: s.merchant_wallet }
            .to_account_metas(None),
    );
    send(&mut s.svm, &merchant, &[], vec![dispute_ix]).expect("dispute should succeed");

    let arbiter = s.arbiter.insecure_clone();
    let resolve_ix = Instruction::new_with_bytes(
        s.program_id,
        &order_escrow::instruction::Resolve { order_id: f.order_id, release_to_merchant: false }.data(),
        order_escrow::accounts::Resolve {
            arbiter: arbiter.pubkey(),
            escrow_config: s.escrow_config,
            order: f.order,
            vault: f.vault,
            buyer_token_account: s.buyer_token,
            merchant_wallet: s.merchant_wallet,
            merchant_token_account: s.merchant_token,
            buyer: s.buyer.pubkey(),
            token_program: spl_token::ID,
        }
        .to_account_metas(None),
    );
    send(&mut s.svm, &arbiter, &[], vec![resolve_ix]).expect("resolve(false) should succeed");

    assert_eq!(order_state(&s.svm, &f.order), OrderState::Refunded);
    assert_eq!(token_balance(&s.svm, &s.buyer_token), BUYER_INITIAL_USDC);
}

#[test]
fn resolve_rejects_non_arbiter() {
    let mut s = setup();
    let f = fund_order(&mut s, 1, 3600);
    let buyer = s.buyer.insecure_clone();
    let dispute_ix = Instruction::new_with_bytes(
        s.program_id,
        &order_escrow::instruction::Dispute { order_id: f.order_id }.data(),
        order_escrow::accounts::Dispute { caller: buyer.pubkey(), order: f.order, merchant_wallet: s.merchant_wallet }
            .to_account_metas(None),
    );
    send(&mut s.svm, &buyer, &[], vec![dispute_ix]).unwrap();

    let attacker = Keypair::new();
    s.svm.airdrop(&attacker.pubkey(), 10_000_000_000).unwrap();
    let resolve_ix = Instruction::new_with_bytes(
        s.program_id,
        &order_escrow::instruction::Resolve { order_id: f.order_id, release_to_merchant: true }.data(),
        order_escrow::accounts::Resolve {
            arbiter: attacker.pubkey(),
            escrow_config: s.escrow_config,
            order: f.order,
            vault: f.vault,
            buyer_token_account: s.buyer_token,
            merchant_wallet: s.merchant_wallet,
            merchant_token_account: s.merchant_token,
            buyer: s.buyer.pubkey(),
            token_program: spl_token::ID,
        }
        .to_account_metas(None),
    );
    let res = send(&mut s.svm, &attacker, &[], vec![resolve_ix]);
    assert!(res.is_err(), "expected NotArbiter rejection");
}

#[test]
fn user_release_fallback_releases_to_merchant() {
    let mut s = setup();
    let f = fund_order(&mut s, 1, 3600);
    let buyer = s.buyer.insecure_clone();

    let ix = Instruction::new_with_bytes(
        s.program_id,
        &order_escrow::instruction::UserRelease { order_id: f.order_id }.data(),
        order_escrow::accounts::UserRelease {
            buyer: buyer.pubkey(),
            order: f.order,
            vault: f.vault,
            merchant_wallet: s.merchant_wallet,
            merchant_token_account: s.merchant_token,
            token_program: spl_token::ID,
        }
        .to_account_metas(None),
    );
    send(&mut s.svm, &buyer, &[], vec![ix]).expect("user_release should succeed");

    assert_eq!(order_state(&s.svm, &f.order), OrderState::Released);
    assert_eq!(token_balance(&s.svm, &s.merchant_token), ORDER_AMOUNT);
}
