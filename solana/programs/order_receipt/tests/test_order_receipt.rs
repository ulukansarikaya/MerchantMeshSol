use {
    anchor_lang::{
        prelude::Pubkey,
        solana_program::{instruction::Instruction, system_program},
        AccountDeserialize, InstructionData, ToAccountMetas,
    },
    litesvm::LiteSVM,
    order_receipt::state::Receipt,
    solana_keypair::Keypair,
    solana_message::{Message, VersionedMessage},
    solana_signer::Signer,
    solana_transaction::versioned::VersionedTransaction,
};

fn program_bytes() -> &'static [u8] {
    include_bytes!(concat!(env!("CARGO_TARGET_TMPDIR"), "/../deploy/order_receipt.so"))
}

struct Setup {
    svm: LiteSVM,
    program_id: Pubkey,
    authority: Keypair,
    relayer: Keypair,
    receipt_config: Pubkey,
}

fn send(svm: &mut LiteSVM, payer: &Keypair, ix: Instruction) -> litesvm::types::TransactionResult {
    let blockhash = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&payer.pubkey()), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[payer]).unwrap();
    svm.send_transaction(tx)
}

fn setup() -> Setup {
    let program_id = order_receipt::id();
    let authority = Keypair::new();
    let relayer = Keypair::new();
    let mut svm = LiteSVM::new();
    svm.add_program(program_id, program_bytes()).unwrap();
    svm.airdrop(&authority.pubkey(), 10_000_000_000).unwrap();
    svm.airdrop(&relayer.pubkey(), 10_000_000_000).unwrap();

    let receipt_config = Pubkey::find_program_address(&[b"receipt_config"], &program_id).0;
    let ix = Instruction::new_with_bytes(
        program_id,
        &order_receipt::instruction::Initialize { relayer: relayer.pubkey() }.data(),
        order_receipt::accounts::Initialize {
            authority: authority.pubkey(),
            receipt_config,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    );
    send(&mut svm, &authority, ix).expect("initialize should succeed");

    Setup { svm, program_id, authority, relayer, receipt_config }
}

fn create_receipt_ix(program_id: Pubkey, relayer: Pubkey, receipt_config: Pubkey, receipt_id: u64) -> (Instruction, Pubkey) {
    let receipt = Pubkey::find_program_address(&[b"receipt", &receipt_id.to_le_bytes()], &program_id).0;
    let ix = Instruction::new_with_bytes(
        program_id,
        &order_receipt::instruction::CreateReceipt {
            receipt_id,
            task_ref: "task-kofte-1".to_string(),
            total_research_micro_usdc: 5_000,
            total_main_micro_usdc: 12_000_000,
            completed_items: 3,
            total_items: 3,
            metadata_uri: "ipfs://metadata".to_string(),
            metadata_hash: [9u8; 32],
        }
        .data(),
        order_receipt::accounts::CreateReceipt {
            relayer,
            receipt_config,
            receipt,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    );
    (ix, receipt)
}

#[test]
fn create_receipt_succeeds_and_stores_fields() {
    let mut s = setup();
    let (ix, receipt_pda) = create_receipt_ix(s.program_id, s.relayer.pubkey(), s.receipt_config, 1);
    send(&mut s.svm, &s.relayer, ix).expect("create_receipt should succeed");

    let account = s.svm.get_account(&receipt_pda).unwrap();
    let mut data: &[u8] = &account.data;
    let receipt = Receipt::try_deserialize(&mut data).unwrap();
    assert_eq!(receipt.receipt_id, 1);
    assert_eq!(receipt.task_ref, "task-kofte-1");
    assert_eq!(receipt.total_main_micro_usdc, 12_000_000);
    assert_eq!(receipt.completed_items, 3);
}

#[test]
fn create_receipt_rejects_non_relayer_signer() {
    let mut s = setup();
    let attacker = Keypair::new();
    s.svm.airdrop(&attacker.pubkey(), 10_000_000_000).unwrap();
    let (ix, _) = create_receipt_ix(s.program_id, attacker.pubkey(), s.receipt_config, 1);
    let res = send(&mut s.svm, &attacker, ix);
    assert!(res.is_err(), "expected Unauthorized rejection");
}

#[test]
fn record_refund_succeeds_and_rejects_non_relayer() {
    let mut s = setup();
    let (create_ix, receipt_pda) = create_receipt_ix(s.program_id, s.relayer.pubkey(), s.receipt_config, 1);
    send(&mut s.svm, &s.relayer, create_ix).unwrap();

    let refund_ix = Instruction::new_with_bytes(
        s.program_id,
        &order_receipt::instruction::RecordRefund { receipt_id: 1, refunded_micro_usdc: 4_000_000 }.data(),
        order_receipt::accounts::RecordRefund {
            relayer: s.relayer.pubkey(),
            receipt_config: s.receipt_config,
            receipt: receipt_pda,
        }
        .to_account_metas(None),
    );
    send(&mut s.svm, &s.relayer, refund_ix).expect("record_refund should succeed");

    let attacker = Keypair::new();
    s.svm.airdrop(&attacker.pubkey(), 10_000_000_000).unwrap();
    let attacker_ix = Instruction::new_with_bytes(
        s.program_id,
        &order_receipt::instruction::RecordRefund { receipt_id: 1, refunded_micro_usdc: 1 }.data(),
        order_receipt::accounts::RecordRefund {
            relayer: attacker.pubkey(),
            receipt_config: s.receipt_config,
            receipt: receipt_pda,
        }
        .to_account_metas(None),
    );
    let res = send(&mut s.svm, &attacker, attacker_ix);
    assert!(res.is_err(), "expected Unauthorized rejection");
}

#[test]
fn create_receipt_rejects_wrong_receipt_id() {
    let mut s = setup();
    let (ix, _) = create_receipt_ix(s.program_id, s.relayer.pubkey(), s.receipt_config, 2);
    let res = send(&mut s.svm, &s.relayer, ix);
    assert!(res.is_err(), "expected ReceiptIdMismatch rejection");
}
