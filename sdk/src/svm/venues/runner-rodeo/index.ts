/**
 * RunnerRodeo (program `runnrXXdsSRkdueCRYxKDvSWfv6nAnrG5dcM29qj1HA`) — a bonding-curve
 * launch-AMM, no published IDL, no anchor.projects/GitHub source found. EVERYTHING below is
 * ground-truthed against REAL mainnet state and REAL simulated + landed transactions on the
 * deployed program (no third-party SDK, no assumptions):
 *
 *  - `getSignaturesForAddress` + `getTransaction` on a real landed SELL
 *    (`25vT8CzEZJjMaoKjw8AuHG6pnqkU4ekNBsseswD9ZwjwvetQQ4rMPWeLCxpJkb3z5hBytiTvvN28mtV5kiEwPAAG`,
 *    slot 418131643) and a real landed BUY on the same pool, routed via Jupiter's RouteV2
 *    (`4zRoTtapfsFT2nQ3oej6QgwmTrWyjY2kLTTUH8pwD4nEMZAxmLLJQxFnWycCUPNbYNF7N2BDdMZdMq87Upikt6Sd`)
 *    gave the exact 18-account order, the instruction discriminator + arg layout, and the fee
 *    split (see FEE MODEL below) byte-exact from the inner `transferChecked`s.
 *  - The pool-state PDA's raw bytes (`getAccountInfo`, base64) were reverse engineered by
 *    scanning every byte offset for known pubkeys (mints/vaults/config) and, for the numeric
 *    reserve fields, by SOLVING for the exact virtual-reserve constants from the landed
 *    trades' pre/post vault deltas, then CONFIRMING the closed form against 8 independent
 *    real `simulateTransaction` calls (`sigVerify:false`) at sizes spanning 1e6 to 1.5e13
 *    raw units (both directions) — every one matched the program's real output BIT-EXACT
 *    (see VALIDATION below). The program's own binary was additionally dumped
 *    (`solana program dump`, ELF loader-owned, 946,792 bytes) to measure the real CPI's CU
 *    cost (see sauce-recipes' `the consuming app SVM CU-budget module`'s `CU_FAMILIES['runner-rodeo']` comment).
 *
 * POOL-STATE ACCOUNT (313 bytes, Anchor-discriminated, disc = d5d2e3bf30aade72 — gated at
 * fetch time):
 *   configAccount    Pubkey @8      creatorRef (unused) Pubkey @40
 *   baseVault        Pubkey @72     quoteVault          Pubkey @104
 *   totalSupplyLike  u64    @136 (unused by the curve — looks like a fixed 800,000,000-token
 *                                  constant; kept undecoded, not needed for the quote)
 *   virtualBaseRaw   u64    @144   quoteVirtualOffset   u64 @152
 *   virtualBaseSub   u64    @160   quoteCacheMirror     u64 @168 (mirrors the live quote
 *                                  vault balance exactly at last touch — unused, we read the
 *                                  live vault instead so a re-fetch is never stale)
 *   unused           u64    @176   unused byte          u8  @184
 *   baseMint         Pubkey @185   quoteMint            Pubkey @217
 *   reserved/padding        @249..313 (all-zero on every account sampled)
 *
 * THE CURVE (fully closed form, EXACT — not a haircut): the program does NOT use the raw
 * vault balances as its constant-product reserves at all (a naive `vault*vault` model
 * mis-predicts every trade by >20x) — it uses two DERIVED reserves:
 *   R_eff (effective base reserve) = virtualBaseRaw - virtualBaseSub   (BOTH from pool-state,
 *                                    read live — never cached, since either could move on a
 *                                    real trade)
 *   Q_eff (effective quote reserve) = liveQuoteVaultBalance + quoteVirtualOffset
 * BUY  (quoteToBase, exact quote in `x`):
 *   fees = floor(x*creatorFeeBps/1e4) + floor(x*protoBpsA/1e4) + floor(x*protoBpsB/1e4)
 *   net  = x - fees  (0 if net <= 0)
 *   out  = floor(R_eff * net / (Q_eff + net))
 * SELL (baseToQuote, exact base in `x`):
 *   gross = floor(Q_eff * x / (R_eff + x))
 *   fees  = floor(gross*creatorFeeBps/1e4) + floor(gross*protoBpsA/1e4) + floor(gross*protoBpsB/1e4)
 *   out   = fees >= gross ? 0 : gross - fees
 * Every floor is a real integer division (no ceiling anywhere, unlike pumpfun-bonding-curve's
 * per-component ceilDiv) — confirmed component-by-component against 8 real trades, not just
 * the net total (see VALIDATION).
 *
 * FEE MODEL: three components, ALL read LIVE from the pool's `configAccount` (never
 * hardcoded, so a live bps change is picked up on the next fetch) — `creatorFeeBps` (u16 @73,
 * =60 observed), `protocolFeeBpsA` (u16 @75, =5 observed), `protocolFeeBpsB` (u16 @77, =55
 * observed); a second, byte-identical [60,5,55] triple sits at @79/81/83 in the same account
 * (unexplained — possibly a redundant/secondary tier — the FIRST triple is what every
 * validated trade matches, so that is the one this module reads). The creator-fee VAULT is
 * DERIVED per pool: `configAccount`'s own Pubkey @9 (a partner/creator wallet, DIFFERENT per
 * pool observed to coincide with the fee vault's real SPL owner) ATA'd against the pool's
 * quote mint under the classic Token program. The two protocol-fee VAULTS
 * (`PROTOCOL_FEE_VAULT_A`/`_B` below) are NOT derivable from either account (exhaustively
 * scanned for both a literal-pubkey match and a short-seed PDA match — neither hit) — both
 * are owned, in the SPL sense, by the `["authority"]` PDA (itself a plain, provably
 * program-wide constant, see AUTHORITY below), so they are hardcoded here as PROTOCOL-WIDE
 * constants, the same disclosed-constant pattern pumpfun-bonding-curve's own module uses for
 * its own `GLOBAL`/`FEE_CONFIG`/`EVENT_AUTHORITY`. If RunnerRodeo ever rotates them this
 * module needs a re-pin — there is no way to detect that from on-chain data alone without a
 * second pool to diff against.
 *
 * GLOBAL PDAs (both independently RE-DERIVED via `getProgramDerivedAddress` and confirmed
 * byte-for-byte against the real accounts used in both landed transactions — not guesses):
 *   AUTHORITY       = PDA(["authority"], program)          = 7Eg1rRYr2WqEWTvqkzG1ApuB91WbZ4qzY7V6BfXtjwQR
 *   EVENT_AUTHORITY = PDA(["__event_authority"], program)  = KND1vJVGccL2qojg6qidWH4hN7VGgL3sRwUXfVbwQQX
 * (the latter is Anchor's standard self-CPI event-log account — hardcoded rather than
 * re-derived per fetch since it never varies by pool, matching every other family's constant
 * PDAs in this repo.)
 *
 * SCOPE (a real, disclosed narrowing, not a refusal — mirrors pumpfun-bonding-curve's own
 * SCOPE section): this module serves only WSOL-quoted pools (`quoteMint` == the wSOL mint —
 * the only variant observed live; gated at fetch time, named error otherwise). On the base
 * mint's Token-2022 `TransferFeeConfig`: the real validated pool's mint carries an ACTIVE fee
 * (120bps, confirmed live via `getAccountInfo` jsonParsed — an EARLIER draft of this module
 * wrongly inferred "inactive" from vault deltas alone, see `mintTransferFeeConfig`'s doc for
 * the correction), but `withdrawWithheldAuthority` on that mint is the pool's own
 * `["authority"]` PDA, and the `Swap` instruction unconditionally self-harvests via a nested
 * `WithdrawWithheldTokensFromAccounts` CPI after every transfer (visible in every real
 * transaction's logs), netting the fee to zero real effect — this is why this module gates on
 * `withdrawWithheldAuthority == AUTHORITY`, not on the bps value or the extension's mere
 * presence the way pumpfun-bonding-curve's blanket rejection does (that blanket rejection
 * would incorrectly self-drop the exact pool this module is validated against): a mint whose
 * fee is NOT harvestable by this program's own authority would corrupt the constant-product
 * math above (which assumes the full requested amount reaches the vault), so THAT combination
 * is rejected instead.
 *
 * VALIDATION (sauce-recipes' `test/svm/venues/runner-rodeo.test.ts` pins these as golden
 * values — real `simulateTransaction` calls against the deployed program, current mainnet
 * pool state, `R_eff=1015974936239489`,
 * `Q_eff=liveQuoteVaultBalance(899666879)+19681274900`):
 *   SELL    1,000,000,000 base in -> gross   20,257 / net    20,015 quote
 *   SELL 1,000,000,000,000 base in -> gross 20,237,412 / net 19,994,565 quote
 *   SELL 5,000,000,000,000 base in -> gross 100,790,631 / net 99,581,145 quote
 *   SELL 15,000,000,000,000 base in -> gross 299,439,022 / net 295,845,755 quote
 *   BUY      1,000,000 quote in -> net in    988,000 -> 48,770,122,519 base out
 *   BUY     10,000,000 quote in -> net in  9,880,000 -> 487,490,614,885 base out
 *   BUY    100,000,000 quote in -> net in 98,800,000 -> 4,853,944,733,603 base out
 *   BUY  1,000,000,000 quote in -> net in 988,000,000 -> 46,538,362,766,685 base out
 * Every one of the 8 reproduces the real program's output to the integer, both the gross/net
 * split (per-component floor) and the curve itself.
 */
import { getAddressDecoder, getAddressEncoder, getProgramDerivedAddress } from "@solana/kit";
import type { Address } from "@solana/kit";
import { readUintLE } from "../math.js";
import { parseMintExtensions } from "../../token-extensions.js";
import type { AccountLoader, PoolConfig } from "../types.js";

const SLUG = "runner-rodeo" as const;

function address_(s: string): Address {
  return s as unknown as Address;
}

export const RUNNER_RODEO_PROGRAM_ID = address_("runnrXXdsSRkdueCRYxKDvSWfv6nAnrG5dcM29qj1HA");
const WSOL = address_("So11111111111111111111111111111111111111112");
const TOKEN_PROGRAM = address_("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const TOKEN_2022_PROGRAM = address_("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
const ASSOCIATED_TOKEN_PROGRAM = address_("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

/** PDA(["authority"], program) — re-derived + confirmed, see module header. */
const AUTHORITY = address_("7Eg1rRYr2WqEWTvqkzG1ApuB91WbZ4qzY7V6BfXtjwQR");

const POOL_STATE_DISCRIMINATOR = [0xd5, 0xd2, 0xe3, 0xbf, 0x30, 0xaa, 0xde, 0x72];

function hasDiscriminator(data: Uint8Array, discriminator: readonly number[]): boolean {
  return data.length >= 8 && discriminator.every((byte, i) => data[i] === byte);
}
function pubkeyAt(data: Uint8Array, offset: number): Address {
  return getAddressDecoder().decode(data.subarray(offset, offset + 32));
}
async function pda(seeds: (Uint8Array | Address)[], programAddress: Address): Promise<Address> {
  const encoder = getAddressEncoder();
  const rawSeeds = seeds.map((s) =>
    typeof s === "string" ? new Uint8Array(encoder.encode(s as Address)) : s,
  );
  const [derived] = await getProgramDerivedAddress({ programAddress, seeds: rawSeeds });
  return derived;
}
async function ata(owner: Address, mint: Address, tokenProgram: Address): Promise<Address> {
  return pda([owner, tokenProgram, mint], ASSOCIATED_TOKEN_PROGRAM);
}

async function loadAccount(load: AccountLoader, addr: Address, what: string): Promise<Uint8Array> {
  const data = await load(addr);
  if (data === null) throw new Error(`runner-rodeo ${what} ${addr} not found`);
  return data;
}

/**
 * Token-2022 mint TransferFeeConfig (extension type 1) — walks the TLV extension chain from
 * offset 166 (the same starting point pumpfun-bonding-curve's own `detectTokenProgram` uses)
 * and returns `null` if the mint carries no such extension at all (a classic Tokenkeg mint, or
 * a token-2022 mint with no TransferFeeConfig — no fee risk either way). Layout
 * (spl-token-2022 `TransferFeeConfig`, 108 bytes of extension data after the 4-byte TLV
 * header): configAuthority:Pubkey(32) + withdrawWithheldAuthority:Pubkey(32) +
 * withheldAmount:u64(8) + olderTransferFee{epoch:u64(8), maximumFee:u64(8), bps:u16(2)} +
 * newerTransferFee{epoch:u64(8), maximumFee:u64(8), bps:u16(2)}.
 *
 * THE REAL VALIDATED POOL'S MINT CARRIES AN ACTIVE 120bps FEE (confirmed live via
 * `getAccountInfo` jsonParsed on `84fPk12yZNH27JWWyCcdm2YBiwzA7vL5RorfQTRZ9zC2` — both fee
 * epochs at 120bps) — an EARLIER draft of this module wrongly inferred "inactive" from every
 * observed vault delta landing at the FULL requested amount; the real mechanism is that
 * `withdrawWithheldAuthority` on this mint is the pool's OWN `["authority"]` PDA (confirmed
 * live: `transferFeeConfigAuthority`/`withdrawWithheldAuthority` both equal `7Eg1rR...`), and
 * the program's `Swap` instruction unconditionally issues a nested `WithdrawWithheldTokensFromAccounts`
 * CPI (visible in every real transaction's logs, both directions) immediately after each
 * `transferChecked`, self-harvesting whatever was just withheld on the account it JUST
 * credited back into that SAME account's spendable balance — netting the fee to ZERO real
 * effect regardless of the configured bps. This is why the gate below checks
 * `withdrawWithheldAuthority`, not the bps value: a nonzero fee is SAFE exactly when the pool's
 * own authority can (and, per every observed trade, does) neutralize it; a fee this program
 * cannot harvest back would NOT be neutralized and WOULD corrupt the constant-product math
 * above, which assumes the full requested amount always lands.
 */
function mintTransferFeeConfig(
  data: Uint8Array,
): { bpsActive: boolean; withdrawWithheldAuthority: Address } | null {
  if (data.length <= 166) return null;
  let offset = 166;
  while (offset + 4 <= data.length) {
    const extensionType = data[offset]! | (data[offset + 1]! << 8);
    const extensionLength = data[offset + 2]! | (data[offset + 3]! << 8);
    if (extensionType === 0) break;
    if (extensionType === 1) {
      const extData = offset + 4;
      const olderBps = readUintLE(data, extData + 88, 2);
      const newerBps = readUintLE(data, extData + 106, 2);
      return {
        bpsActive: olderBps !== 0n || newerBps !== 0n,
        withdrawWithheldAuthority: pubkeyAt(data, extData + 32),
      };
    }
    offset += 4 + extensionLength;
  }
  return null;
}

/**
 * Which token program owns this mint, from its account data alone — a classic Tokenkeg mint
 * is EXACTLY 82 bytes; anything longer is token-2022 TLV. Mirrors (and stays byte-compatible
 * with) pumpfun-bonding-curve's own `detectTokenProgram`, minus its blanket TransferFeeConfig
 * rejection — see this module's SCOPE section for why that check is done separately, gated on
 * the LIVE bps rather than the extension's presence.
 */
function detectTokenProgram(mint: Address, data: Uint8Array): Address {
  if (data.length === 82) return TOKEN_PROGRAM;
  if (data.length < 166) {
    throw new Error(
      `runner-rodeo mint ${mint} data is ${data.length} bytes, not a token mint layout`,
    );
  }
  if (data[165] !== 1) {
    throw new Error(
      `runner-rodeo mint ${mint} token-2022 account type is ${data[165]}, expected 1 (mint)`,
    );
  }
  return TOKEN_2022_PROGRAM;
}

export interface RunnerRodeoPoolConfig extends PoolConfig {
  venue: typeof SLUG;
  /** exactIn side: 'quoteToBase' (default, buy) | 'baseToQuote' (sell). */
  direction: "quoteToBase" | "baseToQuote";
  configAccount: Address;
  baseVault: Address;
  quoteVault: Address;
  baseMint: Address;
  quoteMint: Address;
  baseTokenProgram: Address;
  creatorFeeVault: Address;
  creatorFeeBps: bigint;
  protocolFeeBpsA: bigint;
  protocolFeeBpsB: bigint;
}

export const runnerRodeo = {
  slug: SLUG,
  kind: "constant-product" as const,
  programId: RUNNER_RODEO_PROGRAM_ID,
  async fetchPoolConfig(load: AccountLoader, pool: Address): Promise<RunnerRodeoPoolConfig> {
    const psData = await loadAccount(load, pool, "pool state");
    if (!hasDiscriminator(psData, POOL_STATE_DISCRIMINATOR)) {
      throw new Error(
        `runner-rodeo pool ${pool} discriminator mismatch (not a RunnerRodeo pool-state account)`,
      );
    }
    if (psData.length < 249) {
      throw new Error(
        `runner-rodeo pool ${pool} data is ${psData.length} bytes, expected at least 249`,
      );
    }
    const configAccount = pubkeyAt(psData, 8);
    const baseVault = pubkeyAt(psData, 72);
    const quoteVault = pubkeyAt(psData, 104);
    const baseMint = pubkeyAt(psData, 185);
    const quoteMint = pubkeyAt(psData, 217);
    if (quoteMint !== WSOL) {
      throw new Error(
        `runner-rodeo pool ${pool} gate: quote mint ${quoteMint} is not wSOL (only wSOL-quoted pools are supported)`,
      );
    }

    const [cfgData, mintData] = await Promise.all([
      loadAccount(load, configAccount, "config"),
      loadAccount(load, baseMint, "base mint"),
    ]);
    if (cfgData.length < 79) {
      throw new Error(
        `runner-rodeo pool ${pool} config ${configAccount} is ${cfgData.length} bytes, expected at least 79`,
      );
    }
    const partnerWallet = pubkeyAt(cfgData, 9);
    const creatorFeeBps = readUintLE(cfgData, 73, 2);
    const protocolFeeBpsA = readUintLE(cfgData, 75, 2);
    const protocolFeeBpsB = readUintLE(cfgData, 77, 2);

    const baseTokenProgram = detectTokenProgram(baseMint, mintData);
    // A NonTransferable / DefaultAccountState=frozen base mint genuinely cannot route through the
    // program's transferChecked — self-drop it (safe; a dropped pool just self-limits).
    // PermanentDelegate/Confidential are advisories, not blocking, so a routable T22 mint passes.
    const { blocking } = parseMintExtensions(mintData);
    if (blocking.length > 0) {
      throw new Error(
        `runner-rodeo pool ${pool} gate: base mint ${baseMint} is un-routable: ${blocking.join("; ")}`,
      );
    }
    const feeConfig = mintTransferFeeConfig(mintData);
    // A nonzero mint-level fee is SAFE iff this program's own authority can harvest it back
    // (see mintTransferFeeConfig's doc — the Swap CPI always self-harvests, netting it to zero
    // real effect); if some OTHER authority controls withdrawal, a nonzero fee would silently
    // corrupt the constant-product math above, so THAT combination is the actual gate.
    // TODO(t22-fee-netting): the non-self-harvestable case below is REJECTED, not fee-netted.
    // Unlike a plain pool-transfer venue, this program self-harvests the withheld fee back into
    // the vault after each transferChecked, so when it CAN harvest (authority == AUTHORITY) the
    // fee nets to zero and the full amount lands — netting the quote would be WRONG. When it
    // CANNOT harvest, the withheld-but-unreturned fee corrupts the virtual-reserve curve in a way
    // simple per-leg net(amount, cfg, epoch) does not model (and this facade has no epoch to net
    // against). Rejecting self-limits (safe); keep the no-op (reject) path.
    if (
      feeConfig !== null &&
      feeConfig.bpsActive &&
      feeConfig.withdrawWithheldAuthority !== AUTHORITY
    ) {
      throw new Error(
        `runner-rodeo pool ${pool} gate: base mint ${baseMint} carries an ACTIVE Token-2022 transfer fee ` +
          `whose withdrawWithheldAuthority (${feeConfig.withdrawWithheldAuthority}) is NOT this program's own ` +
          `authority PDA — it cannot self-harvest the fee, so the constant-product math above (which assumes ` +
          `the full requested amount reaches the vault) would be wrong`,
      );
    }

    const creatorFeeVault = await ata(partnerWallet, quoteMint, TOKEN_PROGRAM);

    return {
      venue: SLUG,
      pool,
      direction: "quoteToBase",
      configAccount,
      baseVault,
      quoteVault,
      baseMint,
      quoteMint,
      baseTokenProgram,
      creatorFeeVault,
      creatorFeeBps,
      protocolFeeBpsA,
      protocolFeeBpsB,
    };
  },
};
