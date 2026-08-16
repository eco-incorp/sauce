/**
 * Shared per-mint token-program resolver for the SVM venue adapters.
 *
 * A mint account is owned either by the legacy SPL Token program
 * (TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA) or by Token-2022
 * (TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb). The correct token program is
 * the ACCOUNT OWNER of the mint — but an AccountLoader (see ./venues/types.ts)
 * only returns account DATA, never the owning program. So the primary resolver
 * infers the program from the mint's data SHAPE, exactly as the pumpswap /
 * juplend-amm adapters already do:
 *
 *   - A classic SPL mint is EXACTLY 82 bytes.
 *   - A Token-2022 mint that carries at least one extension is padded to a
 *     165-byte base, then a 1-byte account-type discriminator at offset 165
 *     (== 1 for Mint), then a TLV extension region — so its length is >= 166.
 *
 * Layout cross-checked against the authoritative spl-token-2022 source (the
 * `MintWithTransferFeeConfigLayout` proptest fixture in orca-so/whirlpools:
 * `82 + 83 + 1 + 2 + 2 + 108`, and token-2022 `PodMint`/`PodStateWithExtensions`).
 *
 * THE ONE UNRESOLVABLE CASE, documented rather than papered over: a Token-2022
 * mint with NO extensions is ALSO exactly 82 bytes and byte-for-byte identical
 * to a legacy mint — the two are indistinguishable from data alone. This
 * resolver classifies such a mint as legacy (the common, safe assumption: an
 * extensionless T22 mint has no transfer fee and no blocking extension, so it
 * routes identically to a legacy mint). When a caller genuinely needs the true
 * owner for an extensionless mint (e.g. to pick the right token_program account
 * for a CPI), use `resolveTokenProgramByOwner` with an owner lookup that can
 * read the account's owning program (a full `getAccountInfo`, not the
 * data-only AccountLoader).
 */
import { address } from '@solana/kit';
/** Legacy SPL Token program (classic Tokenkeg). */
export const TOKEN_PROGRAM_ID = address('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
/** Token-2022 program (extensions). */
export const TOKEN_2022_PROGRAM_ID = address('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
/** A classic SPL mint account is exactly this many bytes. */
export const SPL_MINT_SIZE = 82;
/**
 * A Token-2022 mint with extensions pads its base region to this size, then
 * writes the account-type discriminator at this offset (the value itself).
 */
export const T22_ACCOUNT_TYPE_OFFSET = 165;
/** account_type == 1 means Mint (2 means token Account). */
export const T22_ACCOUNT_TYPE_MINT = 1;
/** First byte of the TLV extension region (right after the account-type byte). */
export const T22_TLV_START = 166;
/**
 * Classify a mint's token program from its raw account data alone (pure, no
 * I/O). Returns TOKEN_PROGRAM_ID for a classic 82-byte mint, TOKEN_2022_PROGRAM_ID
 * for a >=166-byte extension mint with the Mint account-type byte. Throws on a
 * length/type that is not a mint layout. See the file header for the one
 * ambiguous case (extensionless T22 mint → classified legacy).
 */
export function classifyMintProgram(mint, data) {
    if (data.length === SPL_MINT_SIZE)
        return TOKEN_PROGRAM_ID;
    if (data.length < T22_TLV_START) {
        throw new Error(`token-program: mint ${mint} data is ${data.length} bytes, not a mint account layout (want 82, or >=166 for token-2022)`);
    }
    if (data[T22_ACCOUNT_TYPE_OFFSET] !== T22_ACCOUNT_TYPE_MINT) {
        throw new Error(`token-program: mint ${mint} account-type byte is ${data[T22_ACCOUNT_TYPE_OFFSET]}, expected ${T22_ACCOUNT_TYPE_MINT} (Mint)`);
    }
    return TOKEN_2022_PROGRAM_ID;
}
/**
 * Resolve the token program serving `mint` by reading its account via the
 * AccountLoader and classifying the data shape. Throws a clear error if the
 * mint account is missing. Resolve PER MINT — a pool can mix a legacy mint on
 * one side and a Token-2022 mint on the other.
 */
export async function resolveTokenProgram(load, mint) {
    const data = await load(mint);
    if (data === null)
        throw new Error(`token-program: mint ${mint} account not found`);
    return classifyMintProgram(mint, data);
}
/**
 * Escape hatch for the extensionless-T22 ambiguity: resolve strictly by the
 * mint's OWNING program, via a lookup that can see the owner (unlike the
 * data-only AccountLoader). Throws if the mint is missing or is owned by
 * neither token program.
 */
export async function resolveTokenProgramByOwner(mint, ownerOf) {
    const owner = await ownerOf(mint);
    if (owner === null)
        throw new Error(`token-program: mint ${mint} account not found (owner lookup)`);
    if (owner === TOKEN_PROGRAM_ID)
        return TOKEN_PROGRAM_ID;
    if (owner === TOKEN_2022_PROGRAM_ID)
        return TOKEN_2022_PROGRAM_ID;
    throw new Error(`token-program: mint ${mint} is owned by ${owner}, neither the legacy nor Token-2022 program`);
}
/** True iff the mint data is a Token-2022 mint (>=166 bytes, Mint account-type byte). */
export function isToken2022Mint(data) {
    return data.length >= T22_TLV_START && data[T22_ACCOUNT_TYPE_OFFSET] === T22_ACCOUNT_TYPE_MINT;
}
/**
 * A caching per-mint resolver: repeated resolves of the same mint within one
 * pool/route read the account once. Returns a resolver function closing over a
 * Map<mintBase58, Address>.
 */
export function createTokenProgramResolver(load) {
    const cache = new Map();
    return async (mint) => {
        const cached = cache.get(mint);
        if (cached !== undefined)
            return cached;
        const program = await resolveTokenProgram(load, mint);
        cache.set(mint, program);
        return program;
    };
}
//# sourceMappingURL=token-program.js.map