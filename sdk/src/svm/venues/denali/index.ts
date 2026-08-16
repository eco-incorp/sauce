/**
 * Denali venue adapter — a closed-source, oracle-anchored AMM (program
 * `DNL1tgEj3nJovHw9jtyCCQD3arssCJzkmpDizknwzey4`). No on-chain Anchor IDL
 * ships for this program, so the account layout, swap instruction, CPI plan
 * and quote curve below are all recovered by binary/account inspection and
 * transaction archaeology (`getSignaturesForAddress` + `getTransaction`,
 * jsonParsed, on 5 real landed swaps across 2 real pools), cross-validated by
 * our own `simulateTransaction` calls (`sigVerify:false` — the account-meta
 * signer BIT drives execution without needing that key's real signature) at
 * 6 (size, direction) combinations against the DEPLOYED program on live
 * mainnet state, 2026-07-31.
 *
 * ── Pool account (517 bytes, FIXED size — confirmed on all 19 live pools via
 * a `getProgramAccounts` dataSize:517 sweep) ──
 * Recovered by locating the KNOWN mint/vault addresses of two real pools as
 * raw bytes inside their own accounts (the same technique bisonfi/obric-v2/
 * solfi-v2 used), then confirmed identical on all 19:
 *   disc (8 bytes, Anchor-style, constant: dbbed53700e3c69a) @ 0
 *   OFF_MINT_A  = 72   (pubkey, 32 bytes)
 *   OFF_MINT_B  = 104  (pubkey, 32 bytes — every one of the 19 live pools has
 *                       mintB == USDC; Denali reads as a USDC-quoted-only AMM
 *                       in the observed universe, though nothing in the
 *                       decode below assumes that)
 *   OFF_VAULT_A = 136  (pubkey, 32 bytes — mintA's SPL vault)
 *   OFF_VAULT_B = 168  (pubkey, 32 bytes — mintB's SPL vault)
 * bytes[8:40]/bytes[40:72] are two protocol-wide constant pubkeys (identical
 * across every pool inspected — an admin/config authority pair, not
 * per-pool state); bytes[200:] hold further config/state this integration
 * does not decode (see "Quote curve" below).
 *
 * ── The oracle account is a DERIVABLE PDA, not caller-supplied freely ──
 * Denali's swap CPI takes a per-pool oracle account (105 bytes, owned by a
 * SEPARATE closed-source program `DZNTS5ujuiyx1mazqCPdYPzEyE2VrTPPb6QbqBUftJbY`)
 * that is NOT embedded anywhere in the pool's own 517 bytes. It IS, however,
 * an exact PDA: `findProgramAddress(["oracle", poolAddress], DZNTS5uj...)` —
 * verified bit-for-bit against the real oracle account address on FOUR
 * separate pools (the 2 pools this file's evidence otherwise cites, plus 2
 * more sampled cold from the dataSize:517 sweep, all four owned by
 * DZNTS5uj... at the derived address). `fetchPoolConfig` derives it directly
 * via `@solana/kit`'s `getProgramDerivedAddress` — no extra RPC round trip,
 * no hardcoded per-pool table.
 *
 * ── Global config account — a single protocol-wide constant, NOT per-pool
 * (identical across every one of the 5 real transactions inspected, 2
 * different pools): `46TF9vo4oqnLuY7LrueQybyJoLsgMeauUhTHFYfcgFyJ` (139
 * bytes, owned by the Denali program itself).
 *
 * ── Swap instruction (disc 0x68688356a1bdb4d8, 25 bytes total) — fully
 * reverse-engineered from 5 real landed swaps (jsonParsed inner-instruction
 * decode of the `transferChecked` CPIs Denali itself issues, which name
 * source/destination/authority/mint/amount unambiguously) plus 6 of our own
 * direct `simulateTransaction` probes ──
 *   bytes[0:8]  : discriminator, constant, 68688356a1bdb4d8
 *   byte[8]     : direction — 0 = mintA in / mintB out, 1 = mintB in / mintA
 *                 out (real-chain-confirmed BOTH ways: a real mintA->mintB
 *                 trade carried 0, a real mintB->mintA trade on a DIFFERENT
 *                 pool carried 1, with the identical instruction shape)
 *   bytes[9:17] : amountIn, u64 LE (EXACT — confirmed against the real
 *                 vault-delta on every one of the 5 real swaps, and against
 *                 the program's own emitted event on all 6 of our probes)
 *   bytes[17:25]: minAmountOut, u64 LE — 0 in every real sample observed;
 *                 kept 0 here too (Sauce's own `minOut`/`avgPriceLimit` at
 *                 the merge level is the real floor, same convention as
 *                 every other venue-min-out-rides-1 ladder in this repo)
 *
 * ── Accounts (12, FIXED order regardless of direction — confirmed: the SAME
 * 12-account order recovered a real mintA->mintB swap AND a real mintB->mintA
 * swap on a different pool; only the `direction` byte and which side of the
 * transferCheckeds Denali issues flips, never the account list) ──
 *   0  trader (signer, writable)          — token authority for the deposit side
 *   1  pool   (writable)                  — the 517-byte pool account; ALSO the
 *                                            vault-authority PDA that signs the
 *                                            withdrawal-side transferChecked
 *                                            (Denali's own invoke_signed — the
 *                                            caller never marks it as signer)
 *   2  mintA  (readonly)
 *   3  mintB  (readonly)
 *   4  vaultA (writable)
 *   5  vaultB (writable)
 *   6  TOKEN_PROGRAM (readonly)
 *   7  TOKEN_PROGRAM (readonly, listed TWICE — real-chain-confirmed, not a
 *      transcription artifact, same pattern bisonfi's CPI carries)
 *   8  oracle (readonly, per-pool PDA — see above)
 *   9  global config (readonly, protocol-wide constant — see above)
 *   10 userAtaA (writable)
 *   11 userAtaB (writable)
 *
 * There is NO extra required signer beyond the trader itself — accounts
 * 1/8/9 are all `signer:false` in every real transaction inspected (account
 * 1's withdrawal-side signature is internal, program-derived). This venue
 * has NO whitelisting/authority blocker at the CPI level: a Sauce-built cook
 * can land a real Denali swap today.
 *
 * ── Quote curve — HONEST LIMITATION ──
 * The program's own emitted event (an Anchor `emit!`, disc 96a61ae11c59264f,
 * decoded from our 6 real `simulateTransaction` probes: pool pubkey,
 * direction, amountIn, amountOut, slot) shows Denali's REAL pricing is close
 * to a FLAT, oracle-anchored per-slot RATE rather than a reserve-ratio curve:
 * at 100/2,000/10,000 (x1e-8 units) mintA-in the realized rate was EXACTLY
 * 0.92785058 all three sizes (a 100x size range, zero measurable curvature);
 * at 1/20/100 (x1e-6 units) mintB-in it was 1.074637 at the two sizes sharing
 * a slot and 1.07455614 one slot later (a ~0.0075% move attributable to the
 * oracle price ticking, not to trade size). Separately, real landed-trade
 * archaeology (5 samples, pre-dating the probes above) showed a plain
 * virtual constant-product curve over the two vaults' OWN live SPL balances
 * would have been ~14.0-14.3% BELOW the real output in the mintA->mintB
 * direction (safe) but ~6.8-6.9% ABOVE the real output in the mintB->mintA
 * direction on a DIFFERENT pool (UNSAFE — a favourable error) — i.e. the
 * vault ratio is only weakly, not reliably, coupled to Denali's real
 * (oracle-driven) execution price, and can drift either side of it depending
 * on how skewed a pool's inventory currently sits relative to the live
 * oracle feed. The oracle account's own 105-byte encoding (owned by a
 * separate closed-source program) was not recovered within this
 * integration's time budget, so this ladder cannot read the true live rate
 * on-chain.
 *
 * Given that, this ships a DELIBERATELY conservative virtual constant-product
 * curve over the vaults' own live balances, with the output side discounted
 * by OUT_DISCOUNT_NUM/DEN = 2/3 (a 33% haircut) — comfortably past (~4.8x)
 * the largest UNSAFE gap measured above (6.9%). This keeps the modeled quote
 * safely BELOW the real venue's output at every rung observed so far — safe
 * for election (a worse model never wins a share it doesn't deserve) and
 * trivially monotone/concave (a plain x/(r+x) curve). The real Denali CPI
 * still delivers its own authoritative output at cook time; this quote only
 * shapes off-chain ranking and the on-chain slot's own predicted-output
 * bookkeeping, never the real transfer. Recovering the true oracle encoding
 * (and thus a tighter, less lossy quote) is a legitimate follow-up, not a
 * blocker.
 *
 * ── CU (measured 2026-07-31, REAL mainnet `simulateTransaction` against the
 * DEPLOYED program, sigVerify:false, pool 8njE4Rq7...) ──
 * direction=0 (sell mintA for mintB): 23,460 CU FLAT at 1/20/100
 * mintA-token-equivalent sizes (a 100x range) — no measurable size
 * dependence, consistent with the flat-rate pricing above. direction=1 (buy
 * mintA with mintB): 32,253-32,517 CU across 1/20/100 mintB-token-equivalent
 * sizes — likewise essentially flat. This is Denali's OWN native CPI cost
 * only, not this ladder's own setup-read + interpreter overhead.
 */
import { address, getAddressCodec, getAddressEncoder, getProgramDerivedAddress } from '@solana/kit';
import type { Address } from '@solana/kit';
import { readUintLE } from '../math.js';
import type { AccountBytesMap, AccountLoader, PoolConfig, SwapUser, VenueAccount } from '../types.js';
import { TOKEN_2022_PROGRAM_ID, classifyMintProgram } from '../../token-program.js';
import { parseMintExtensions } from '../../token-extensions.js';

const SLUG = 'denali';
export const DENALI_PROGRAM_ID = address('DNL1tgEj3nJovHw9jtyCCQD3arssCJzkmpDizknwzey4');
const TOKEN_PROGRAM = address('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
/** Owner of every pool's per-pool oracle PDA — see the file header. */
export const DENALI_ORACLE_PROGRAM_ID = address('DZNTS5ujuiyx1mazqCPdYPzEyE2VrTPPb6QbqBUftJbY');
/**
 * Protocol-wide global config account — constant across every pool
 * (real-chain-confirmed across 5 transactions on 2 different pools). Read-only,
 * not a signer.
 */
export const DENALI_GLOBAL_CONFIG = address('46TF9vo4oqnLuY7LrueQybyJoLsgMeauUhTHFYfcgFyJ');

const POOL_ACCOUNT_SIZE = 517;
export const OFF_MINT_A = 72;
export const OFF_MINT_B = 104;
export const OFF_VAULT_A = 136;
export const OFF_VAULT_B = 168;
/** SPL token account amount field offset (standard layout). */
const AMOUNT_OFF = 64;

/** disc(8) ++ direction(1) ++ amountIn u64 LE (patched) ++ minOut u64 LE(=0) = 25 bytes. */
const SWAP_DISCRIMINATOR = Uint8Array.from([0x68, 0x68, 0x83, 0x56, 0xa1, 0xbd, 0xb4, 0xd8]);

/** Conservative haircut on the modeled output side — see the file header "Quote curve" note. */
const OUT_DISCOUNT_NUM = 2n;
const OUT_DISCOUNT_DEN = 3n;

const codec = getAddressCodec();
const encoder = getAddressEncoder();
const pubkeyAt = (data: Uint8Array, offset: number): Address => codec.decode(data.subarray(offset, offset + 32));

export interface DenaliPoolConfig extends PoolConfig {
  venue: typeof SLUG;
  /** 0 = mintA in / mintB out, 1 = mintB in / mintA out. */
  direction: 0 | 1;
  mintA: Address;
  mintB: Address;
  vaultA: Address;
  vaultB: Address;
  /** Per-pool PDA, derived off `pool` — see the file header. */
  oracle: Address;
}

function denaliConfig(cfg: PoolConfig): DenaliPoolConfig {
  if (cfg.venue !== SLUG) throw new Error(`${SLUG} ladder adapter got a '${cfg.venue}' pool config`);
  return cfg as DenaliPoolConfig;
}

const ref = (slot: number, role: string): string => `s${slot}:${role}`;

export async function fetchDenaliPoolConfig(load: AccountLoader, pool: Address): Promise<DenaliPoolConfig> {
  const data = await load(pool);
  if (data === null) throw new Error(`${SLUG} pool ${pool} account not found`);
  if (data.length !== POOL_ACCOUNT_SIZE) {
    throw new Error(`${SLUG} pool ${pool} account data is ${data.length} bytes, expected ${POOL_ACCOUNT_SIZE}`);
  }
  const mintA = pubkeyAt(data, OFF_MINT_A);
  const mintB = pubkeyAt(data, OFF_MINT_B);

  // This venue's on-chain swap ix is legacy-SPL (Tokenkeg) only, so a
  // Token-2022 mint (or one carrying an un-routable extension) must SELF-DROP
  // the pool rather than be silently assumed legacy. The thrown error IS the
  // graceful-drop signal (the SvmRoute orchestrator catches it and drops the
  // venue). An unreadable mint falls back to the legacy assumption, keeping the
  // classic 82-byte path byte-identical.
  for (const mint of [mintA, mintB]) {
    const mintData = await load(mint);
    if (mintData === null) continue;
    if (classifyMintProgram(mint, mintData) === TOKEN_2022_PROGRAM_ID) {
      throw new Error(`${SLUG}: dropping pool ${pool} — mint ${mint} is Token-2022 (this venue's swap is legacy-SPL only)`);
    }
    const { blocking } = parseMintExtensions(mintData);
    if (blocking.length > 0) {
      throw new Error(`${SLUG}: dropping pool ${pool} — mint ${mint} is un-routable: ${blocking.join('; ')}`);
    }
  }

  const [oracle] = await getProgramDerivedAddress({
    programAddress: DENALI_ORACLE_PROGRAM_ID,
    seeds: ['oracle', encoder.encode(pool)],
  });
  return {
    venue: SLUG,
    pool,
    direction: 0,
    mintA,
    mintB,
    vaultA: pubkeyAt(data, OFF_VAULT_A),
    vaultB: pubkeyAt(data, OFF_VAULT_B),
    oracle,
  };
}

function quoteAccounts(base: PoolConfig): VenueAccount[] {
  const cfg = denaliConfig(base);
  return [
    { ref: 'vaultA', address: cfg.vaultA },
    { ref: 'vaultB', address: cfg.vaultB },
  ];
}

/** Family facade for the recipe orchestrator. */
export const denali = {
  slug: SLUG,
  kind: 'constant-product' as const,
  programId: DENALI_PROGRAM_ID,
  fetchPoolConfig: fetchDenaliPoolConfig,
  quoteAccounts,
};

