/**
 * cctp-transfer — the step-one demo from the team thread: a Base→Arbitrum USDC transfer, "with
 * interop/CCTP and without".
 *
 * The two route PROGRAMS are standalone `.sauce.ts` assets (`cctp-split.sauce.ts`,
 * `plain-transfer.sauce.ts`) — NOT strings assembled here. Each defines a parameterized `main(...)`;
 * this builder reads the asset from disk (like `settleSource()`) and bakes THIS intent's concrete
 * values in as compile-time `args`, exactly the mechanism `settle.sauce.ts` uses. Because `args` is a
 * TS-compiler feature (the RS/WASM compiler has no args field), the routes compile through the
 * default TS compiler.
 *
 * DSL-NATIVE BY CONSTRUCTION — the programs hardcode NO ABI and NO address. `USDC` resolves to the
 * source chain's USDC from the token registry; `Cctp.TokenMessenger.depositForBurn(...)` resolves
 * interface + address from the CCTP protocol descriptor; the ambient define `Cctp_TokenMessenger`
 * (the approve spender) is that same address. The only inputs are this intent's config.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { requireChain, type ChainRef } from "../chains/canonical.js";
import { CCTP_DOMAIN } from "../protocols/cctp/addresses.js";
import { openRoute, type BuiltIntent, type RewardArg } from "../routes/intent-dsl.js";
import type { AddressInput } from "../routes/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Absolute path to the CCTP split-burn program asset inside THIS installed package. */
export const CCTP_SPLIT_SOURCE_PATH: string = join(__dirname, "cctp-split.sauce.ts");
/** Absolute path to the plain-transfer baseline program asset inside THIS installed package. */
export const PLAIN_TRANSFER_SOURCE_PATH: string = join(__dirname, "plain-transfer.sauce.ts");

let cctpSplitCache: string | null = null;
let plainTransferCache: string | null = null;

/** The `cctp-split.sauce.ts` program text — read once and cached. */
export function cctpSplitSource(): string {
  if (cctpSplitCache === null) cctpSplitCache = readFileSync(CCTP_SPLIT_SOURCE_PATH, "utf-8");
  return cctpSplitCache;
}
/** The `plain-transfer.sauce.ts` program text — read once and cached. */
export function plainTransferSource(): string {
  if (plainTransferCache === null) plainTransferCache = readFileSync(PLAIN_TRANSFER_SOURCE_PATH, "utf-8");
  return plainTransferCache;
}

function toBig(a: AddressInput): bigint {
  return typeof a === "bigint" ? a : BigInt(a);
}

export interface CctpTransferParams {
  /** Source chain — where USDC is burned (CCTP delivers to `to` asynchronously). */
  readonly from: ChainRef;
  /** Destination chain — where CCTP mints the USDC. */
  readonly to: ChainRef;
  /** Total USDC to move, in USDC's own 6 decimals. */
  readonly amount: bigint;
  /** Circle's per-message burn cap on `from` — the reason the transfer is split. */
  readonly perMessageLimit: bigint;
  /** Who receives the minted USDC on `to`. */
  readonly recipient: AddressInput;
  /** CCTP fast-deposit fee charged per chunk (default 0). */
  readonly maxFeePerChunk?: bigint;

  // ---- intent wiring ----
  readonly pot: AddressInput;
  readonly portal: AddressInput;
  readonly sourcePortal?: AddressInput;
  readonly deadline: bigint | number | string;
  readonly rewardDeadline?: bigint | number | string;
  readonly creator: AddressInput;
  readonly prover: AddressInput;
  readonly reward: RewardArg;
}

/**
 * Splits `amount` into as many full `limit`-sized chunks as fit, plus whatever is left over
 * (`0 <= remainder < limit`). The recipe burns the `count` full chunks in its loop and, when
 * `remainder > 0`, one final sub-limit burn — so the ENTIRE amount moves regardless of whether it
 * divides evenly by the per-message cap (`$2.50` at a `$1` cap → 2×`$1` + `$0.50`).
 */
function splitChunks(amount: bigint, limit: bigint): { count: bigint; chunk: bigint; remainder: bigint } {
  if (limit <= 0n || amount <= 0n) throw new Error("cctp-transfer: amount and perMessageLimit must be > 0");
  return { count: amount / limit, chunk: limit, remainder: amount % limit };
}

function common(params: CctpTransferParams) {
  return {
    pot: params.pot,
    portal: params.portal,
    sourcePortal: params.sourcePortal,
    deadline: params.deadline,
    rewardDeadline: params.rewardDeadline,
    source: params.from,
    creator: params.creator,
    prover: params.prover,
  };
}

/**
 * WITH CCTP — one intent whose route burns `amount` via a for-loop of `count` full sub-limit
 * `depositForBurn`s plus one final `remainder` burn when the amount doesn't divide evenly by the
 * cap, atomic in one cook. Fulfilled locally on the source chain, so the intent's destination IS
 * its source. `main(recipient, chunk, count, remainder, destinationDomain, maxFee)` is baked with
 * this intent's values as compile-time `args`.
 */
export function buildCctpSplitTransfer(params: CctpTransferParams): BuiltIntent {
  const dest = requireChain(params.to);
  const destDomain = CCTP_DOMAIN[dest.slug];
  if (destDomain === undefined) throw new Error(`cctp-transfer: no CCTP domain registered for destination '${dest.slug}'`);
  const { count, chunk, remainder } = splitChunks(params.amount, params.perMessageLimit);
  const recipient = toBig(params.recipient);
  const maxFee = params.maxFeePerChunk ?? 0n;

  return openRoute(params.from, cctpSplitSource(), {
    ...common(params),
    compile: { args: [recipient, chunk, count, remainder, BigInt(destDomain), maxFee] },
  }).reward(params.reward);
}

/**
 * WITHOUT CCTP (the baseline) — a plain cross-chain USDC transfer intent: the solver delivers
 * `amount` USDC to `recipient` on the destination chain via the normal Eco flow, no bridge stitch.
 * `main(recipient, amount)` is baked with this intent's values as compile-time `args`.
 */
export function buildPlainTransfer(params: CctpTransferParams): BuiltIntent {
  const recipient = toBig(params.recipient);

  return openRoute(params.to, plainTransferSource(), {
    ...common(params),
    compile: { args: [recipient, params.amount] },
  }).reward(params.reward);
}
