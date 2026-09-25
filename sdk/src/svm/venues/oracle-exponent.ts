/**
 * Oracle exponent range validation — the guard between an attacker-influenceable
 * (or merely corrupt) oracle account and `10n ** BigInt(expo)`.
 *
 * WHY THIS EXISTS. Three adapters bake a power of ten derived from an oracle
 * account's `i32` exponent field at fetch time: carrot's per-asset `scaleExp`,
 * obric-v2's `feedScale`, and woofi's `pythQuoteDecPow`. The field is read
 * straight out of account bytes, so its full `i32` domain is reachable by anyone
 * who can put bytes in front of the loader.
 *
 * Measured on this repo's Node 22, because the shape of the hazard decides the
 * shape of the fix: `10n ** 10_000_000n` takes ~0.5s, `10n ** 50_000_000n`
 * ~2.2s, and `10n ** 100_000_000n` was still running when killed at 20s. Only
 * at the very top of the range does V8 refuse on sight — `10n ** 2_147_483_647n`
 * raises `RangeError: Maximum BigInt size exceeded` in ~27ms. So the dangerous
 * exponent is NOT i32::MAX; it is the mid-range (~1e7..1e9) that slips under
 * V8's size check and burns the quoting thread for minutes. That is a denial of
 * QUOTE AVAILABILITY (the off-chain path only — nothing here runs on-chain, and
 * this buys no compute-unit savings).
 *
 * A range check BEFORE the exponentiation is therefore the fix, and a try/catch
 * around it is not: in the mid-range there is nothing to catch until the CPU is
 * already spent, and at the extremes the RangeError that does arrive is an
 * unhandled error class rather than a deterministic, actionable venue drop.
 *
 * WHY A RANGE AND NOT A CLAMP. An out-of-range exponent means the account is not
 * what the adapter thinks it is. Folding it to the nearest valid value would
 * return a confidently wrong price; throwing self-drops the venue (every caller
 * here is inside `fetchPoolConfig`, whose throw `resolveSvmPoolSpec` catches as
 * a drop). A wrong quote is worse than no quote.
 *
 * NOT TOKEN DECIMALS. The sibling `10n ** BigInt(decimals)` sites in these same
 * adapters (carrot's `a.decimals`, obric-v2's `decimalMults`, woofi's
 * `priceDec`/`quoteDec`/`baseDec`) are NOT this risk and are deliberately left
 * alone: every one reads a single byte (`data[off]`), so it is structurally
 * bounded to 0..=255 and `10n ** 255n` is a 107-byte integer. Only the `i32`
 * oracle fields are unbounded. Keep the two kinds distinct.
 */

/**
 * The oracle account FORMATS these adapters decode an exponent out of. The
 * issuer is Pyth in both cases; the formats differ in how the bound reaches
 * them, which is why they are separate rows rather than one global constant.
 */
export type OracleExponentProvider = "pyth-price-update-v2" | "pyth-v2-price-account";

/**
 * `MAX_NUM_DECIMALS` as the Pythnet oracle program itself defines it:
 * pyth-network/pyth-client, `program/rust/src/c_oracle_header.rs` —
 *
 *   /// Bound on the range of the exponent in price accounts. This number is set
 *   /// such that the PD-based EMA computation does not lose too much precision.
 *   pub const MAX_NUM_DECIMALS: i32 = 12;
 *
 * enforced by `utils::check_exponent_range`, which asserts
 * `(-MAX_NUM_DECIMALS..=MAX_NUM_DECIMALS).contains(&expo)`. That check runs in
 * `processor::add_price` and `processor::init_price` — the only two instructions
 * in the program that ever write `price_data.exponent` — so no Pyth price
 * account can carry an exponent outside [-12, 12].
 */
export const PYTH_MAX_NUM_DECIMALS = 12;

export interface OracleExponentRange {
  /** Inclusive lower bound. */
  readonly min: number;
  /** Inclusive upper bound. */
  readonly max: number;
  /** Where the bound comes from — cited, not assumed. */
  readonly provenance: string;
}

export const ORACLE_EXPONENT_RANGES: Readonly<Record<OracleExponentProvider, OracleExponentRange>> =
  Object.freeze({
    /**
     * Pyth Solana Receiver `PriceUpdateV2.price_message.exponent` (carrot, woofi).
     * The receiver SDK does NOT re-validate: `price_update.rs` copies
     * `self.price_message.exponent` straight through. The bound is inherited from
     * the Pythnet price accounts the Wormhole-attested message is built from, and
     * it is precisely because the receiver does not re-check it that this SDK must
     * — an account handed to our loader carries no attestation we verified.
     */
    "pyth-price-update-v2": Object.freeze({
      min: -PYTH_MAX_NUM_DECIMALS,
      max: PYTH_MAX_NUM_DECIMALS,
      provenance:
        "pyth-client MAX_NUM_DECIMALS=12, inherited via the Wormhole-attested PriceFeedMessage (pyth-solana-receiver does not re-validate)",
    }),
    /**
     * Legacy Pyth v2 price account, magic 0xa1b2c3d4, `expo_` at byte 20
     * (obric-v2's relay feeds). This IS `pc_price_t`, so the bound is the oracle
     * program's own `check_exponent_range` applied directly to this account.
     */
    "pyth-v2-price-account": Object.freeze({
      min: -PYTH_MAX_NUM_DECIMALS,
      max: PYTH_MAX_NUM_DECIMALS,
      provenance:
        "pyth-client MAX_NUM_DECIMALS=12, enforced on this exact account by check_exponent_range in add_price/init_price",
    }),
  });

/**
 * Deterministic range gate: same bytes in, same throw out, before any BigInt
 * power is constructed. Rejects the whole out-of-range `i32` domain, extremes
 * included. Note what `Math.abs` does NOT do here: `Math.abs(i32::MIN)` is
 * 2147483648 — a perfectly ordinary, safe JS integer that sails into `BigInt`
 * intact. Taking an absolute value bounds the SIGN, never the MAGNITUDE, so the
 * gate has to reject on the value itself.
 *
 * @param provider which account format the exponent was decoded from
 * @param expo the decoded, sign-corrected `i32`
 * @param context caller-supplied identity (venue, pool, account) for the error
 */
export function assertOracleExponent(
  provider: OracleExponentProvider,
  expo: number,
  context: string,
): void {
  const { min, max } = ORACLE_EXPONENT_RANGES[provider];
  if (!Number.isInteger(expo) || expo < min || expo > max) {
    throw new Error(
      `${context}: oracle exponent ${expo} is outside the supported ${provider} range [${min}, ${max}] — refusing to raise 10 to an unvalidated oracle-controlled power`,
    );
  }
}
