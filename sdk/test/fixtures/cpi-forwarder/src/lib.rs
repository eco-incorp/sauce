//! Test-only CPI forwarder: an arbitrary third-party program that a wallet calls at the top level
//! and that CPIs into whatever program it is told to, with the caller's signer and writable
//! privileges passed straight through. `cli-policy-svm.test.ts` has it call the Kitchen's cook
//! with the wallet as owner, which the Kitchen takes at any depth. Dependency-free on purpose (the
//! loader's input read raw, one syscall), so it builds offline.
//!
//! Accounts:  [0] the program to call, [1..] the accounts of the call, each with the flags it
//!            arrived with. Instruction data: the callee's instruction data, verbatim.
//!
//! Rebuild `cpi_forwarder.so` (platform-tools v1.52) from this directory:
//!   PATH="$HOME/.cache/solana/v1.52/platform-tools/rust/bin:$PATH" \
//!     cargo-build-sbf --offline --no-rustup-override --sbf-out-dir . && rm cpi_forwarder-keypair.json
#![no_std]
#![allow(clippy::missing_safety_doc)]

use core::panic::PanicInfo;

#[panic_handler]
fn panic(_: &PanicInfo) -> ! {
    loop {}
}

#[repr(C)]
#[derive(Clone, Copy)]
struct Info {
    key: *const u8,
    lamports: *mut u64,
    data_len: u64,
    data: *mut u8,
    owner: *const u8,
    rent_epoch: u64,
    is_signer: u8,
    is_writable: u8,
    executable: u8,
}

#[repr(C)]
struct Meta {
    pubkey: *const u8,
    is_writable: u8,
    is_signer: u8,
}

#[repr(C)]
struct Ix {
    program_id: *const u8,
    accounts: *const Meta,
    account_len: u64,
    data: *const u8,
    data_len: u64,
}

extern "C" {
    fn sol_invoke_signed_c(
        instruction: *const Ix,
        infos: *const Info,
        infos_len: u64,
        seeds: *const u8,
        seeds_len: u64,
    ) -> u64;
}

const HEAP: usize = 0x3_0000_0000;
const MAX_ACCOUNTS: usize = 48;

#[no_mangle]
pub unsafe extern "C" fn entrypoint(input: *mut u8) -> u64 {
    let infos = HEAP as *mut Info;
    let metas = (HEAP + MAX_ACCOUNTS * core::mem::size_of::<Info>()) as *mut Meta;

    let mut at = input;
    let count = *(at as *const u64) as usize;
    at = at.add(8);
    if count < 1 || count > MAX_ACCOUNTS {
        return 1;
    }
    for i in 0..count {
        let marker = *at;
        if marker == 0xff {
            let data_len = *(at.add(80) as *const u64);
            let data = at.add(88);
            let info = Info {
                key: at.add(8),
                lamports: at.add(72) as *mut u64,
                data_len,
                data,
                owner: at.add(40),
                rent_epoch: 0,
                is_signer: *at.add(1),
                is_writable: *at.add(2),
                executable: *at.add(3),
            };
            at = data.add(data_len as usize + 10240);
            at = at.add((at as usize).wrapping_neg() & 7);
            at = at.add(8);
            infos.add(i).write(info);
        } else {
            infos.add(i).write(*infos.add(marker as usize));
            at = at.add(8);
        }
    }
    let data_len = *(at as *const u64);
    let data = at.add(8);

    for i in 1..count {
        let info = &*infos.add(i);
        metas.add(i - 1).write(Meta {
            pubkey: info.key,
            is_writable: info.is_writable,
            is_signer: info.is_signer,
        });
    }
    let ix = Ix {
        program_id: (*infos).key,
        accounts: metas,
        account_len: (count - 1) as u64,
        data,
        data_len,
    };

    sol_invoke_signed_c(&ix, infos, count as u64, core::ptr::null(), 0)
}
