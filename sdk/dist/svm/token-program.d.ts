import type { Address } from '@solana/kit';
import type { AccountLoader } from './venues/types.js';
/** Legacy SPL Token program (classic Tokenkeg). */
export declare const TOKEN_PROGRAM_ID: Address;
/** Token-2022 program (extensions). */
export declare const TOKEN_2022_PROGRAM_ID: Address;
/** A classic SPL mint account is exactly this many bytes. */
export declare const SPL_MINT_SIZE = 82;
/**
 * A Token-2022 mint with extensions pads its base region to this size, then
 * writes the account-type discriminator at this offset (the value itself).
 */
export declare const T22_ACCOUNT_TYPE_OFFSET = 165;
/** account_type == 1 means Mint (2 means token Account). */
export declare const T22_ACCOUNT_TYPE_MINT = 1;
/** First byte of the TLV extension region (right after the account-type byte). */
export declare const T22_TLV_START = 166;
/** Async owner lookup for the escape-hatch resolver — returns the OWNING program id. */
export type OwnerLoader = (mint: Address) => Promise<Address | null>;
/**
 * Classify a mint's token program from its raw account data alone (pure, no
 * I/O). Returns TOKEN_PROGRAM_ID for a classic 82-byte mint, TOKEN_2022_PROGRAM_ID
 * for a >=166-byte extension mint with the Mint account-type byte. Throws on a
 * length/type that is not a mint layout. See the file header for the one
 * ambiguous case (extensionless T22 mint → classified legacy).
 */
export declare function classifyMintProgram(mint: Address, data: Uint8Array): Address;
/**
 * Resolve the token program serving `mint` by reading its account via the
 * AccountLoader and classifying the data shape. Throws a clear error if the
 * mint account is missing. Resolve PER MINT — a pool can mix a legacy mint on
 * one side and a Token-2022 mint on the other.
 */
export declare function resolveTokenProgram(load: AccountLoader, mint: Address): Promise<Address>;
/**
 * Escape hatch for the extensionless-T22 ambiguity: resolve strictly by the
 * mint's OWNING program, via a lookup that can see the owner (unlike the
 * data-only AccountLoader). Throws if the mint is missing or is owned by
 * neither token program.
 */
export declare function resolveTokenProgramByOwner(mint: Address, ownerOf: OwnerLoader): Promise<Address>;
/** True iff the mint data is a Token-2022 mint (>=166 bytes, Mint account-type byte). */
export declare function isToken2022Mint(data: Uint8Array): boolean;
/**
 * A caching per-mint resolver: repeated resolves of the same mint within one
 * pool/route read the account once. Returns a resolver function closing over a
 * Map<mintBase58, Address>.
 */
export declare function createTokenProgramResolver(load: AccountLoader): (mint: Address) => Promise<Address>;
//# sourceMappingURL=token-program.d.ts.map