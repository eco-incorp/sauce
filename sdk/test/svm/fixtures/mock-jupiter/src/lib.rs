//! A stand-in for Jupiter's aggregator, for `sdk/test/cli-solana-swap.e2e.test.ts`: its
//! `shared_accounts_route` instruction as far as a Sauce program drives it, deployed at Jupiter's
//! program id so the SDK's route checks run unchanged.
//!
//! It takes the instruction's accounts at Jupiter's own positions — 0 token program, 1 program
//! authority, 2 user transfer authority (the signer), 3 source token account, 4 program source
//! token account, 5 program destination token account, 6 destination token account, 7 source
//! mint, 8 destination mint, 9 platform fee account, 10 Token-2022 program, 11 event authority —
//! and its data's tail: `in_amount`, `quoted_out_amount`, `slippage_bps`, `platform_fee_bps`. It
//! pulls `in_amount` from the source account (the user signing), pays the amount the first eight
//! bytes of account 11 hold (an account of this program's, which a test sets) from the program's
//! destination account (signed by its `authority` PDA), and refuses a payment below
//! `quoted_out_amount * (10000 - slippage_bps) / 10000` with Jupiter's own
//! `SlippageToleranceExceeded` (6001). It logs how many accounts it was passed.
use solana_program::{
    account_info::AccountInfo,
    entrypoint,
    entrypoint::ProgramResult,
    instruction::{AccountMeta, Instruction},
    msg,
    program::{invoke, invoke_signed},
    program_error::ProgramError,
    pubkey::Pubkey,
};

entrypoint!(process);

/// `shared_accounts_route`'s Anchor discriminator: sha256 of `global:shared_accounts_route`.
const SHARED_ACCOUNTS_ROUTE: [u8; 8] = [0xc1, 0x20, 0x9b, 0x33, 0x41, 0xd6, 0x9c, 0x81];

fn word(data: &[u8], at: usize) -> u64 {
    u64::from_le_bytes(data[at..at + 8].try_into().unwrap())
}

/// SPL Token's `Transfer` (3) of `amount`, signed by `authority` — or, with `seeds`, by this
/// program for it.
fn transfer<'a>(
    accounts: &[AccountInfo<'a>],
    token: &AccountInfo<'a>,
    from: &AccountInfo<'a>,
    to: &AccountInfo<'a>,
    authority: &AccountInfo<'a>,
    amount: u64,
    seeds: Option<&[&[u8]]>,
) -> ProgramResult {
    let mut data = vec![3u8];
    data.extend_from_slice(&amount.to_le_bytes());
    let instruction = Instruction {
        program_id: *token.key,
        accounts: vec![
            AccountMeta::new(*from.key, false),
            AccountMeta::new(*to.key, false),
            AccountMeta::new_readonly(*authority.key, true),
        ],
        data,
    };
    match seeds {
        Some(seeds) => invoke_signed(&instruction, accounts, &[seeds]),
        None => invoke(&instruction, accounts),
    }
}

pub fn process(program_id: &Pubkey, accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    if data.len() < 8 + 4 + 19 || data[..8] != SHARED_ACCOUNTS_ROUTE {
        return Err(ProgramError::InvalidInstructionData);
    }
    // What the caller passed, for a test to read off the logs.
    msg!("mock-jupiter: {} accounts", accounts.len());
    let tail = data.len() - 19;
    let in_amount = word(data, tail);
    let quoted_out = word(data, tail + 8) as u128;
    let slippage = u16::from_le_bytes([data[tail + 16], data[tail + 17]]) as u128;
    let [token, program_authority, user_authority, source, program_source, program_destination, destination, _source_mint, _destination_mint, _fee, _token_2022, config, ..] =
        accounts
    else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    if !user_authority.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    if config.owner != program_id {
        return Err(ProgramError::IllegalOwner);
    }
    let pay = word(&config.data.borrow(), 0);
    if (pay as u128) < quoted_out * (10_000 - slippage) / 10_000 {
        return Err(ProgramError::Custom(6001));
    }
    transfer(accounts, token, source, program_source, user_authority, in_amount, None)?;
    let (authority, bump) = Pubkey::find_program_address(&[b"authority"], program_id);
    if authority != *program_authority.key {
        return Err(ProgramError::InvalidSeeds);
    }
    transfer(
        accounts,
        token,
        program_destination,
        destination,
        program_authority,
        pay,
        Some(&[b"authority", &[bump]]),
    )
}
