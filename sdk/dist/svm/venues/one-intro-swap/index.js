/**
 * 1DEX (on-chain crate name `one-intro-swap`, program
 * `DEXYosS6oEGvk8uCDayvwEZz4qEyDJRf9nFgYCaqPMTm`) — a 2-mint constant-product
 * pool with NO on-chain Anchor IDL account (confirmed: the standard
 * `createAddressWithSeed(findProgramAddress([], programId), "anchor:idl",
 * programId)` PDA does not exist on mainnet). Fully binary-reverse-engineered
 * for this integration: no public source, no SDK, `programs/one-intro-swap`
 * is a private crate whose name only surfaces via embedded Anchor log/error
 * strings in the dumped binary (`strings` on a `solana program dump`), never
 * published (confirmed absent from GitHub).
 *
 * ACCOUNT MODEL — TWO account kinds, not one pool account:
 *  - **`PoolState`** (432 bytes, one per market, owner = the program) — this
 *    is the `pool` address this adapter's `fetchPoolConfig` takes. Ground-
 *    truthed by diffing the account before/after real-CPI swaps in LiteSVM
 *    (bisection: zeroing 8-byte words and re-running the swap) against the
 *    ONE live mainnet market found (a SOL/USDC pool: PoolState
 *    `DbuvwPuLvH8uy2B1sKuu18aCd2QpCvfZdfDtdRZztBd2`):
 *      disc@0 (8B, `f7ede3f5d7c3de46` on the live pool) · vaultAuthority@8
 *      (32B, a program-signed PDA, no seeds needed by this adapter — it
 *      rides the swap CPI as a plain read-only account) · [40..88] unused by
 *      SwapExactAmountIn (unidentified — likely creator/lp-mint/admin
 *      refs, `programs/one-intro-swap/src/instructions/{join_pool,exit_pool}`
 *      territory) · mint0@89 (32B) · vault0@121 (32B, the mint-0 token
 *      account) · **virtualReserve0@153 (8B, u64 LE)** · [161..168] unused
 *      by this instruction · mint1@169 (32B) · vault1@201 (32B) ·
 *      **virtualReserve1@233 (8B, u64 LE)** · [241..431] unused.
 *  - **`MetadataState`** (232 bytes, GLOBAL — one instance for the whole
 *      program, not per-market) — the account this file hardcodes as
 *      `ONE_INTRO_SWAP_METADATA_STATE`. Evidence for "global, not per-pool":
 *      the dumped binary's own Anchor instruction log strings enumerate
 *      `CreateMetadataState` (singular) as a SEPARATE instruction from
 *      `CreatePoolState` (the per-market one) — a metadata/fee-config
 *      account created once, referenced by every market's swaps. It rides
 *      every `SwapExactAmountIn` CPI read-only and NEVER changes across any
 *      swap this integration observed (byte-identical account snapshots
 *      before/after, and a `PoolState`-only diff explains 100% of the
 *      state mutation — see ./ladder.ts's module header for the full
 *      before/after CU-calibration proof). Its own 32-byte offsets 8..39 and
 *      40..71 do not decode to any known pubkey in this pool's account set
 *      (checked byte-for-byte, not just base58-eyeballed); offset 40..71 IS
 *      required (zeroing it reverts every swap with the program's own
 *      `ConstraintInvalidTokenAccount`), so it is real, load-bearing state —
 *      just not anything this adapter's math needs to interpret, exactly
 *      like a ladder passing an opaque required PDA through untouched. ONE
 *      MARKET has been found and validated end to end; if a second 1DEX
 *      market ever surfaces with a DIFFERENT MetadataState address, this
 *      constant needs generalizing (no evidence exists yet either way —
 *      ship what is proven rather than block on an untestable hypothetical).
 *
 * SWAP INSTRUCTION — `SwapExactAmountIn(amount_in: u64, minimum_amount_out:
 * u64)`, disc sha256("global:swap_exact_amount_in")[0..8] (the Anchor debug
 * log confirms the name — `Instruction: SwapExactAmountIn` — the 8-byte
 * prefix itself is read directly off a real instruction's data, not
 * re-derived from the name), 11 accounts (metadata[ro],
 * pool_state[rw], vault_authority[ro], vault_in[rw], vault_out[rw],
 * owner[signer,rw], user_token_in[rw], user_token_out[rw], fee_a[rw],
 * fee_b[rw], token_program[ro]) — ground-truthed against a real mainnet
 * Jupiter-routed transaction's inner instructions (`getTransaction`
 * `jsonParsed`, innerInstructions at the CPI stack height directly below
 * `DEXYos...`), then re-derived and CONFIRMED via direct real-CPI calls in
 * LiteSVM (this adapter's own construction, not copied from the observed
 * transaction's account list — the observed transaction only proves the
 * ACCOUNTS, not which of them the math actually reads). `vault_in`/
 * `vault_out` swap POSITIONS (not identities) with direction — accounts[3]
 * is always whichever vault the deposit lands in, accounts[4] always the
 * payout vault; direction is inferred by the program from the account
 * roles, never a data-blob flag (the 24-byte data blob is
 * disc(8)+amountIn(8)+minOut(8), no direction byte, and is IDENTICAL in
 * shape/discriminator for both directions of the one real market observed).
 *
 * FEE MODEL — see ./ladder.ts's module header for the exact fee/curve math
 * (fully bit-exact, real-CPI proven against the live binary at 6+ sizes
 * both directions). This file only owns: the two fixed fee-collector
 * OWNERS (their ATAs per input mint are what the swap ix actually takes —
 * ground-truthed via a real mainnet check: the SPL owner field of the four
 * observed fee token accounts collapses to exactly two distinct pubkeys,
 * one per fee stream, shared across both mints) and the MetadataState
 * passthrough.
 *
 * Like obric-v2 (the nearest structural analogue — also no-IDL and
 * binary-RE'd, also caps its payout at the live output vault balance), the
 * PRICE here does not come from an external oracle; it comes from the
 * pool's own self-tracked virtual-reserve pair (see ./ladder.ts).
 */
import { getAddressCodec, getProgramDerivedAddress } from '@solana/kit';
import { readUintLE } from '../math.js';
import { TOKEN_2022_PROGRAM_ID, classifyMintProgram } from '../../token-program.js';
import { parseMintExtensions } from '../../token-extensions.js';
const SLUG = 'one-intro-swap';
export const ONE_INTRO_SWAP_PROGRAM_ID = 'DEXYosS6oEGvk8uCDayvwEZz4qEyDJRf9nFgYCaqPMTm';
const TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const ASSOCIATED_TOKEN_PROGRAM_ID = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
/**
 * The ONE known `MetadataState` — see the module header's "global, not
 * per-pool" evidence. Required by every swap (accounts[0], read-only).
 */
export const ONE_INTRO_SWAP_METADATA_STATE = '5nmAbnjJfW1skrPvYjLTBNdhoKzJfznnbvDcM8G2U7Ki';
/**
 * The two fixed fee-collector owners — ground-truthed via the real mainnet
 * SOL/USDC market's four fee token accounts (2 per mint side): each owner's
 * ATA for whichever mint is being DEPOSITED is where that stream's cut
 * lands (see ./ladder.ts for the exact per-swap amount, always
 * `floor(amountIn / 100_000)` per stream).
 */
export const ONE_INTRO_SWAP_FEE_OWNER_A = 'ATowQwFzdJBJ9VFSfoNKmuB8GiSeo8foM5vRriwmKmFB';
export const ONE_INTRO_SWAP_FEE_OWNER_B = '45ruCyfdRkWpRNGEqWzjCiXRHkZs8WXCLQ67Pnpye7Hp';
// PoolState (432 bytes) byte offsets — see the module header.
const POOL_STATE_SIZE = 432;
const OFF_DISC = 0;
const OFF_AUTHORITY = 8;
const OFF_MINT0 = 89;
const OFF_VAULT0 = 121;
export const OFF_VIRTUAL_RESERVE0 = 153;
const OFF_MINT1 = 169;
const OFF_VAULT1 = 201;
export const OFF_VIRTUAL_RESERVE1 = 233;
/** disc@0 of a live PoolState — Anchor's own `account:PoolState` sighash. */
const POOL_STATE_DISCRIMINATOR = [0xf7, 0xed, 0xe3, 0xf5, 0xd7, 0xc3, 0xde, 0x46];
/** SPL token account `amount` (u64 LE) offset — standard Tokenkeg layout. */
export const TOKEN_ACCOUNT_AMOUNT_OFFSET = 64;
export function oneIntroSwapConfig(base) {
    if (base.venue !== SLUG)
        throw new Error(`one-intro-swap adapter got a '${base.venue}' pool config`);
    return base;
}
async function deriveAta(owner, mint) {
    const enc = getAddressCodec();
    const [ata] = await getProgramDerivedAddress({
        programAddress: ASSOCIATED_TOKEN_PROGRAM_ID,
        seeds: [enc.encode(owner), enc.encode(TOKEN_PROGRAM_ID), enc.encode(mint)],
    });
    return ata;
}
export async function fetchOneIntroSwapPoolConfig(load, pool) {
    const data = await load(pool);
    if (data === null)
        throw new Error(`one-intro-swap PoolState ${pool} not found`);
    if (data.length !== POOL_STATE_SIZE) {
        throw new Error(`one-intro-swap PoolState ${pool} is ${data.length} bytes, expected ${POOL_STATE_SIZE}`);
    }
    for (let i = 0; i < 8; i++) {
        if (data[OFF_DISC + i] !== POOL_STATE_DISCRIMINATOR[i]) {
            throw new Error(`one-intro-swap PoolState ${pool} has a wrong discriminator`);
        }
    }
    const codec = getAddressCodec();
    const pubkey = (offset) => codec.decode(data.subarray(offset, offset + 32));
    const authority = pubkey(OFF_AUTHORITY);
    const mint0 = pubkey(OFF_MINT0);
    const vault0 = pubkey(OFF_VAULT0);
    const mint1 = pubkey(OFF_MINT1);
    const vault1 = pubkey(OFF_VAULT1);
    const virtualReserve0 = readUintLE(data, OFF_VIRTUAL_RESERVE0, 8);
    const virtualReserve1 = readUintLE(data, OFF_VIRTUAL_RESERVE1, 8);
    // A drained/deactivated market has a zero virtual reserve on one side —
    // the ladder's own quote helper also floors x==0 / zero-reserve inputs to
    // 0, but gating a dead market out at fetch time (like every other family's
    // "empty reserve" gate) keeps it out of the universe entirely rather than
    // surviving as a permanent zero-quote slot.
    if (virtualReserve0 === 0n || virtualReserve1 === 0n) {
        throw new Error(`one-intro-swap PoolState ${pool} has a zero virtual reserve (0=${virtualReserve0}, 1=${virtualReserve1})`);
    }
    // Token-2022 safety: this venue's SwapExactAmountIn ix is legacy-SPL (Tokenkeg)
    // only, so a Token-2022 mint (or one carrying an un-routable extension)
    // SELF-DROPS the pool via a thrown, clearly-described error — the SvmRoute
    // orchestrator catches a fetchPoolConfig throw and drops the venue. The legacy
    // path stays byte-identical: a classic 82-byte mint classifies as legacy → no
    // throw, and an unreadable mint (not vendored by a fixture) falls back to legacy.
    const mints = [mint0, mint1];
    const mintDatas = await Promise.all(mints.map((mint) => load(mint)));
    for (let mi = 0; mi < mints.length; mi++) {
        const mint = mints[mi];
        const mintData = mintDatas[mi];
        if (mintData === null)
            continue;
        if (classifyMintProgram(mint, mintData) === TOKEN_2022_PROGRAM_ID) {
            throw new Error(`${SLUG}: dropping pool ${pool} — mint ${mint} is Token-2022 (this venue's swap is legacy-SPL only)`);
        }
        const { blocking } = parseMintExtensions(mintData);
        if (blocking.length > 0) {
            throw new Error(`${SLUG}: dropping pool ${pool} — mint ${mint} is un-routable: ${blocking.join('; ')}`);
        }
    }
    const [feeA0, feeB0, feeA1, feeB1] = await Promise.all([
        deriveAta(ONE_INTRO_SWAP_FEE_OWNER_A, mint0),
        deriveAta(ONE_INTRO_SWAP_FEE_OWNER_B, mint0),
        deriveAta(ONE_INTRO_SWAP_FEE_OWNER_A, mint1),
        deriveAta(ONE_INTRO_SWAP_FEE_OWNER_B, mint1),
    ]);
    return {
        venue: SLUG,
        pool,
        authority,
        mint0,
        vault0,
        mint1,
        vault1,
        feeA0,
        feeB0,
        feeA1,
        feeB1,
        direction: '0to1',
    };
}
//# sourceMappingURL=index.js.map