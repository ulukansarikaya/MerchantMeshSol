use {
    anchor_lang::{
        prelude::Pubkey,
        solana_program::{instruction::Instruction, system_program},
        AccountDeserialize, InstructionData, ToAccountMetas,
    },
    litesvm::LiteSVM,
    merchant_directory::state::{DirectoryState, Merchant},
    solana_keypair::Keypair,
    solana_message::{Message, VersionedMessage},
    solana_signer::Signer,
    solana_transaction::versioned::VersionedTransaction,
};

fn program_bytes() -> &'static [u8] {
    include_bytes!(concat!(env!("CARGO_TARGET_TMPDIR"), "/../deploy/merchant_directory.so"))
}

struct Setup {
    svm: LiteSVM,
    program_id: Pubkey,
    authority: Keypair,
    directory_state: Pubkey,
}

fn setup() -> Setup {
    let program_id = merchant_directory::id();
    let authority = Keypair::new();
    let mut svm = LiteSVM::new();
    svm.add_program(program_id, program_bytes()).unwrap();
    svm.airdrop(&authority.pubkey(), 10_000_000_000).unwrap();

    let directory_state = Pubkey::find_program_address(&[b"directory_state"], &program_id).0;
    let ix = Instruction::new_with_bytes(
        program_id,
        &merchant_directory::instruction::Initialize {}.data(),
        merchant_directory::accounts::Initialize {
            authority: authority.pubkey(),
            directory_state,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    );
    send(&mut svm, &authority, ix).expect("initialize should succeed");

    Setup { svm, program_id, authority, directory_state }
}

fn send(svm: &mut LiteSVM, payer: &Keypair, ix: Instruction) -> litesvm::types::TransactionResult {
    let blockhash = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&payer.pubkey()), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[payer]).unwrap();
    svm.send_transaction(tx)
}

fn list_merchant_ix(program_id: Pubkey, authority: Pubkey, directory_state: Pubkey, merchant_id: u64) -> (Instruction, Pubkey) {
    let merchant = Pubkey::find_program_address(&[b"merchant", &merchant_id.to_le_bytes()], &program_id).0;
    let ix = Instruction::new_with_bytes(
        program_id,
        &merchant_directory::instruction::ListMerchant {
            merchant_id,
            agent_id: 42,
            name: "Kofte Ocagi".to_string(),
            category: "restaurant".to_string(),
            endpoint_uri: "https://merchant.example/kofte".to_string(),
            wallet: Pubkey::new_unique(),
            geo_hash: [7u8; 32],
            attestation_uid: [0u8; 32],
        }
        .data(),
        merchant_directory::accounts::ListMerchant {
            authority,
            directory_state,
            merchant,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    );
    (ix, merchant)
}

#[test]
fn list_merchant_succeeds_and_stores_fields() {
    let mut s = setup();
    let (ix, merchant_pda) = list_merchant_ix(s.program_id, s.authority.pubkey(), s.directory_state, 1);
    send(&mut s.svm, &s.authority, ix).expect("list_merchant should succeed");

    let account = s.svm.get_account(&merchant_pda).unwrap();
    let mut data: &[u8] = &account.data;
    let merchant = Merchant::try_deserialize(&mut data).unwrap();
    assert_eq!(merchant.merchant_id, 1);
    assert_eq!(merchant.agent_id, 42);
    assert_eq!(merchant.name, "Kofte Ocagi");
    assert!(merchant.active);

    let state_account = s.svm.get_account(&s.directory_state).unwrap();
    let mut state_data: &[u8] = &state_account.data;
    let state = DirectoryState::try_deserialize(&mut state_data).unwrap();
    assert_eq!(state.next_merchant_id, 2);
}

#[test]
fn list_merchant_rejects_wrong_merchant_id() {
    let mut s = setup();
    // next_merchant_id is 1, but we claim merchant_id 2 -> mismatch.
    let (ix, _) = list_merchant_ix(s.program_id, s.authority.pubkey(), s.directory_state, 2);
    let res = send(&mut s.svm, &s.authority, ix);
    assert!(res.is_err(), "expected MerchantIdMismatch rejection");
}

#[test]
fn list_merchant_rejects_non_authority_signer() {
    let mut s = setup();
    let attacker = Keypair::new();
    s.svm.airdrop(&attacker.pubkey(), 10_000_000_000).unwrap();
    let (ix, _) = list_merchant_ix(s.program_id, attacker.pubkey(), s.directory_state, 1);
    let res = send(&mut s.svm, &attacker, ix);
    assert!(res.is_err(), "expected Unauthorized rejection");
}

#[test]
fn set_active_toggles_flag_and_rejects_non_authority() {
    let mut s = setup();
    let (list_ix, merchant_pda) = list_merchant_ix(s.program_id, s.authority.pubkey(), s.directory_state, 1);
    send(&mut s.svm, &s.authority, list_ix).unwrap();

    let deactivate_ix = Instruction::new_with_bytes(
        s.program_id,
        &merchant_directory::instruction::SetActive { merchant_id: 1, active: false }.data(),
        merchant_directory::accounts::SetActive {
            authority: s.authority.pubkey(),
            directory_state: s.directory_state,
            merchant: merchant_pda,
        }
        .to_account_metas(None),
    );
    send(&mut s.svm, &s.authority, deactivate_ix).expect("set_active should succeed");

    let account = s.svm.get_account(&merchant_pda).unwrap();
    let mut data: &[u8] = &account.data;
    let merchant = Merchant::try_deserialize(&mut data).unwrap();
    assert!(!merchant.active);

    let attacker = Keypair::new();
    s.svm.airdrop(&attacker.pubkey(), 10_000_000_000).unwrap();
    let attacker_ix = Instruction::new_with_bytes(
        s.program_id,
        &merchant_directory::instruction::SetActive { merchant_id: 1, active: true }.data(),
        merchant_directory::accounts::SetActive {
            authority: attacker.pubkey(),
            directory_state: s.directory_state,
            merchant: merchant_pda,
        }
        .to_account_metas(None),
    );
    let res = send(&mut s.svm, &attacker, attacker_ix);
    assert!(res.is_err(), "expected Unauthorized rejection");
}
