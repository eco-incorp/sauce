/**
 * cctp-transfer — the step-one demo from the team thread: a Base→Arbitrum USDC transfer, "with
 * interop/CCTP and without". The CCTP variant splits the amount into N sub-`perMessageLimit` chunks
 * burned in ONE atomic Sauce cook — a for-loop of `depositForBurn`, so if any chunk reverts (e.g. it
 * exceeds Circle's per-message burn cap) the WHOLE source-chain tx reverts (all-or-nothing).
 *
 * DSL-NATIVE BY CONSTRUCTION — the route bodies hardcode NO ABI and NO address. `USDC` resolves to
 * the source chain's USDC address from the token registry; `Cctp.TokenMessenger.depositForBurn(...)`
 * resolves interface+address from the CCTP protocol in the descriptor registry; and the auto-injected
 * ambient define `Cctp_TokenMessenger` is that same address for the `approve` spender. The only inputs
 * are the intent config (amount, per-message limit, recipient). Compiles through the Rust compiler.
 */
import { requireChain, type ChainRef } from "../chains/canonical.js";
import { CCTP_DOMAIN } from "../protocols/cctp/addresses.js";
import { openRoute, type BuiltIntent, type RewardArg } from "../routes/intent-dsl.js";
import type { AddressInput } from "../routes/types.js";

const RS = { compiler: "rs" as const };

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

/** This step-one demo splits into EQUAL sub-limit chunks (`$2` at a `$1` cap → 2×`$1`). */
function evenChunks(amount: bigint, limit: bigint): { count: bigint; chunk: bigint } {
  if (limit <= 0n || amount <= 0n) throw new Error("cctp-transfer: amount and perMessageLimit must be > 0");
  if (amount % limit !== 0n) {
    throw new Error("cctp-transfer: step-one demo splits into EQUAL sub-limit chunks — amount must be a multiple of perMessageLimit");
  }
  return { count: amount / limit, chunk: limit };
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
 * WITH CCTP — one intent whose route burns `amount` in N equal sub-limit chunks via a for-loop of
 * `depositForBurn`, atomic in one cook. Fulfilled locally on the source chain, so the intent's
 * destination IS its source.
 */
export function buildCctpSplitTransfer(params: CctpTransferParams): BuiltIntent {
  const dest = requireChain(params.to);
  const destDomain = CCTP_DOMAIN[dest.slug];
  if (destDomain === undefined) throw new Error(`cctp-transfer: no CCTP domain registered for destination '${dest.slug}'`);
  const { count, chunk } = evenChunks(params.amount, params.perMessageLimit);

  const recipient = toBig(params.recipient);
  const maxFee = params.maxFeePerChunk ?? 0n;
  // The burn LOGIC is a parameterized function; `main()` calls it with THIS intent's values, which
  // the compiler bakes in at compile time (call args → constant-folded prologue). One approval for
  // the whole batch, then N burns against it. USDC + Cctp.TokenMessenger resolve from the DSL.
  const body = `function cctpSplit(recipient, chunk, n, destDomain, maxFee) {
  USDC.approve(Cctp_TokenMessenger, chunk * n);
  for (let i = 0n; i < n; i = i + 1n) {
    Cctp.TokenMessenger.depositForBurn(chunk, destDomain, recipient, USDC, 0n, maxFee, 0n);
  }
  return 0n;
}
function main() {
  return cctpSplit(${recipient}n, ${chunk}n, ${count}n, ${BigInt(destDomain)}n, ${maxFee}n);
}`;

  return openRoute(params.from, body, { ...common(params), compile: RS }).reward(params.reward);
}

/**
 * WITHOUT CCTP (the baseline) — a plain cross-chain USDC transfer intent: the solver delivers
 * `amount` USDC to `recipient` on the destination chain via the normal Eco flow, no bridge stitch.
 */
export function buildPlainTransfer(params: CctpTransferParams): BuiltIntent {
  const recipient = toBig(params.recipient);
  const body = `function transfer(recipient, amount) {
  USDC.transfer(recipient, amount);
  return 0n;
}
function main() {
  return transfer(${recipient}n, ${params.amount}n);
}`;

  return openRoute(params.to, body, { ...common(params), compile: RS }).reward(params.reward);
}
