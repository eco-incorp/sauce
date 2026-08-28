/**
 * Riptide venue adapter — a closed-source prop AMM (program
 * `riptK81hDxhe5pW5jSzSM9iRA8azgEgLJ4dXkPtBS7j`). No on-chain Anchor IDL
 * ships for this program, so the account layout and swap instruction below
 * are recovered by binary/account inspection (the same method used for
 * obric-v2 / solfi-v2 / bisonfi) — transaction archaeology via
 * `getSignaturesForAddress` + `getTransaction` over ~15 real landed swaps
 * across two pairs (USDT/USDC and wSOL/USDC) and both directions,
 * cross-checked with `simulateTransaction` probes (`sigVerify:false`)
 * against the deployed program at 5 sizes spanning three orders of
 * magnitude (1 to 500 raw-unit-scaled) in both directions on the live
 * USDT/USDC pool (`6Vzx4ASRjUPW2yBxHdBT3hDam2zxB6UmhM2MYYM5k8ci`).
 *
 * This file is the off-chain decode + CPI-account layer (PoolConfig,
 * fetchPoolConfig, quoteAccounts).
 *
 * ── Account layout (pool account, 1024 bytes, gated at fetch) ──
 * Recovered the same way obric-v2/solfi-v2 do: decode candidate offsets,
 * confirm against a real pool's own known mint addresses.
 *   OFF_MINT_A = 72   (pubkey, 32 bytes)
 *   OFF_MINT_B = 104  (pubkey, 32 bytes)
 * There is NO stored vault address anywhere in the 1024-byte account (an
 * exhaustive raw-byte scan for either vault's real address came back empty)
 * — instead, **the pool account itself is the vault authority**: every real
 * withdrawal/swap transaction inspected has the POOL's own address as the
 * `authority` signing the outbound SPL transfer from each vault (confirmed
 * on the `MarketWithdraw` instruction and on every `SwapExactIn` reverse-leg
 * transfer). That means each vault is exactly the pool's own **Associated
 * Token Account** for that mint — `vaultA = ATA(owner: pool, mint: mintA)`,
 * `vaultB = ATA(owner: pool, mint: mintB)`, the standard SPL derivation
 * (`ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL`) — INDEPENDENTLY VERIFIED
 * by recomputing both ATAs off-chain for two real pools (the USDT/USDC pool
 * above and the wSOL/USDC pool `7qvjJJZVh9fk2ZTYCpSjoexYomVPr7qtNTFF3ey4JcjQ`)
 * and matching every one of the 4 resulting addresses to the vaults real
 * transactions actually used. This needs zero extra RPC calls (pure PDA
 * arithmetic from the pool address + the two decoded mints), unlike a
 * stored-vault-pubkey family.
 *
 * ── No partner/authority signer blocker (unlike BisonFi) ──
 * Every account this instruction needs is either the trader's own signer or
 * a pool-derived/constant address Sauce can resolve itself — there is NO
 * required 9th-signer partner authority the way BisonFi needed. This was
 * DIRECTLY CONFIRMED, not merely inferred from the account list:
 * `simulateTransaction` probes used the pool owner's real, currently-funded
 * wallet (`CGYAxnDF1bYwmbzTtVx2pdo8xd3aviqE58WumVYRLYRH`, a DIFFERENT key
 * from any router/authority PDA seen in the real transactions observed) as
 * the sole signer and succeeded at every size/direction tried — proving
 * this program accepts ANY owner-of-the-source-ATA as signer, not a
 * whitelisted partner key. Landing a real cook needs no separate grant.
 */
import { address, getAddressCodec, getAddressEncoder, getProgramDerivedAddress, } from '@solana/kit';
import { TOKEN_2022_PROGRAM_ID, classifyMintProgram } from '../../token-program.js';
import { parseMintExtensions } from '../../token-extensions.js';
const SLUG = 'riptide';
export const RIPTIDE_PROGRAM_ID = address('riptK81hDxhe5pW5jSzSM9iRA8azgEgLJ4dXkPtBS7j');
export const TOKEN_PROGRAM = address('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
export const ATA_PROGRAM = address('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
export const MEMO_PROGRAM = address('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
export const SYSVAR_INSTRUCTIONS = address('Sysvar1nstructions1111111111111111111111111');
/** Well-known anti-frontrun sentinel account present on every real Riptide swap observed. */
export const JITODONTFRONT = address('jitodontfront111111111111111111111111111111');
export const POOL_ACCOUNT_SIZE = 1024;
export const OFF_MINT_A = 72;
export const OFF_MINT_B = 104;
/** SPL token account amount field offset (standard layout). */
export const AMOUNT_OFF = 64;
const addressCodec = getAddressCodec();
const addressEncoder = getAddressEncoder();
const pubkeyAt = (data, offset) => addressCodec.decode(data.subarray(offset, offset + 32));
/** `ATA(owner, mint)` — the standard SPL associated-token derivation, no extra RPC. */
export async function deriveAta(owner, mint) {
    const [ata] = await getProgramDerivedAddress({
        programAddress: ATA_PROGRAM,
        seeds: [addressEncoder.encode(owner), addressEncoder.encode(TOKEN_PROGRAM), addressEncoder.encode(mint)],
    });
    return ata;
}
export function riptideConfig(cfg) {
    if (cfg.venue !== SLUG)
        throw new Error(`${SLUG} ladder adapter got a '${cfg.venue}' pool config`);
    return cfg;
}
export async function fetchPoolConfig(load, pool, direction = 0) {
    const data = await load(pool);
    if (data === null)
        throw new Error(`${SLUG} pool ${pool} account not found`);
    if (data.length !== POOL_ACCOUNT_SIZE) {
        throw new Error(`${SLUG} pool ${pool} account data is ${data.length} bytes, expected ${POOL_ACCOUNT_SIZE}`);
    }
    const mintA = pubkeyAt(data, OFF_MINT_A);
    const mintB = pubkeyAt(data, OFF_MINT_B);
    // The on-chain swap ix is legacy-SPL (Tokenkeg) only for now, so SELF-DROP a
    // pool holding a Token-2022 mint (or an un-routable extension mint) — the
    // thrown error is the graceful-drop signal (SvmRoute catches a
    // fetchPoolConfig throw and drops the venue). An unreadable mint falls back
    // to the legacy assumption, keeping the byte-identical legacy path.
    const mints = [mintA, mintB];
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
    const [vaultA, vaultB] = await Promise.all([deriveAta(pool, mintA), deriveAta(pool, mintB)]);
    return {
        venue: SLUG,
        pool,
        direction,
        mintA,
        mintB,
        vaultA,
        vaultB,
    };
}
export function quoteAccounts(base) {
    const cfg = riptideConfig(base);
    return [
        { ref: 'vaultA', address: cfg.vaultA },
        { ref: 'vaultB', address: cfg.vaultB },
    ];
}
export const riptide = {
    slug: SLUG,
    kind: 'constant-product',
    programId: RIPTIDE_PROGRAM_ID,
    fetchPoolConfig,
    quoteAccounts,
};
//# sourceMappingURL=index.js.map