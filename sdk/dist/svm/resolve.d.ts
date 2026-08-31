import { AccountRole } from '@solana/kit';
import type { Address, TransactionSigner } from '@solana/kit';
import type { AccountManifest } from 'sauce-next';
/**
 * Maps each declared slot of the compiler's AccountManifest to a concrete
 * address. `signer: true` upgrades the role only; pass the TransactionSigner
 * itself to also sign the transaction with it (required for any signer ref
 * other than the reserved fee-payer ref — the send layer has no other way to
 * obtain that signature).
 */
export interface AccountResolution {
    [ref: string]: Address | {
        address: Address;
        signer?: boolean | TransactionSigner;
    };
}
/**
 * Reserved ref: resolves to the fee payer with signer:true (use it when
 * bytecode reads MSG_SENDER). A resolution entry under this key is a conflict
 * and throws — rename the plan ref if it must resolve to another address.
 */
export declare const PAYER_REF = "payer";
export interface ResolveAccountsOptions {
    /**
     * Append the fee payer as a readonly signer at the END of the tail (plan
     * indices stay stable) when no resolved meta already signs. The engine's
     * NoSigner is LAZY — raised only when the program executes
     * MSG_SENDER/TX_ORIGIN — so a signerless list is valid for programs that
     * never read the sender (and lets simulations run sigVerify: false with no
     * signer at all). Set this for MSG_SENDER-reading programs whose plan
     * carries no signer meta; prefer the reserved 'payer' ref when the payer
     * should occupy a plan slot instead.
     */
    appendPayerSigner?: boolean;
}
export interface ResolvedAccountMeta {
    address: Address;
    role: AccountRole;
    /**
     * Present only when the resolution attached a TransactionSigner — kit's
     * signTransactionMessageWithSigners collects it from the instruction meta
     * (detection is `'signer' in meta`, so the key is omitted, not undefined).
     */
    signer?: TransactionSigner;
}
/**
 * Resolves an AccountManifest into ordered account metas: metas[i] is
 * user-account index i of the execute instruction (inline: instruction account
 * i; staged: i + 1, after the buffer). The base role comes from the slot's
 * `requires`; signer is upgraded by that role, the resolution entry's signer
 * flag or TransactionSigner, or the reserved PAYER_REF. An attached
 * TransactionSigner rides on the meta so the transaction builder signs with it.
 * Duplicate addresses across refs are fine — Solana dedupes at message compile.
 *
 * A `remaining` entry is a POSITION, not an account: it marks where the
 * caller's own variable-length tail begins, so resolution stops there and the
 * caller appends its tail itself.
 *
 * MSG_SENDER/TX_ORIGIN is the first in-list signer, resolved LAZILY by the
 * engine (NoSigner only when the program actually reads the sender) — so no
 * signer is auto-appended; a MSG_SENDER-reading program whose manifest
 * declares no signer slot passes `appendPayerSigner: true`.
 */
export declare function resolveAccounts(manifest: AccountManifest, resolution: AccountResolution, payer: Address, { appendPayerSigner }?: ResolveAccountsOptions): ResolvedAccountMeta[];
//# sourceMappingURL=resolve.d.ts.map