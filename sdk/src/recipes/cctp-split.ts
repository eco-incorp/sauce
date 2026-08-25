/**
 * cctp-split — a reference recipe: bridge a large USDC amount over Circle CCTP by SPLITTING it into
 * N sub-limit `depositForBurn` chunks and bundling every chunk into ONE intent whose Sauce route
 * program burns them in a single `V12Pot.cook`.
 *
 * WHY SPLIT: Circle's CCTP `TokenMessenger` enforces a per-message burn cap
 * (`burnLimitsPerMessage`), so a transfer larger than that cap cannot be a single `depositForBurn`
 * — it must be broken into several. The naive way is N independent intents (one burn each), but
 * those settle INDEPENDENTLY: one can land while another fails, leaving the user's money
 * half-bridged. This recipe instead emits ONE intent whose route is a single Sauce program that
 * performs every `approve`+`depositForBurn` pair. A `V12Pot.cook` executes that whole program in
 * ONE EVM transaction, so if ANY chunk reverts (it exceeds the live per-message cap, the Pot is
 * short, a burn reverts) the WHOLE source-chain fulfillment reverts — all-or-nothing. That is the
 * atomicity the "stitch many bridge messages into one intent" use case needs.
 *
 * COMPILED THROUGH THE RUST COMPILER: the route body is compiled via `compile: { compiler: 'rs' }`
 * (the P6 compiler-selector seam, `routes/rs-compile.ts`) rather than the TypeScript compiler — so
 * this recipe doubles as a live demonstration that the intent DSL now drives the RS/WASM compiler
 * end to end (inline ABIs cross the `inlineContracts` WASM boundary; the burn program's external
 * `approve`/`depositForBurn` calls compile and ABI-encode identically to the TS path).
 *
 * SCOPE: CCTP does 100% of the cross-chain movement here. (Circle Gateway is NOT a second bridge
 * leg from inside an intent — its destination mint needs an off-chain EIP-712 BurnIntent signature
 * + Circle attestation an on-chain `Call` cannot emit; eco-routes uses Gateway only as a
 * destination-side deposit SINK on top of CCTP. See `eco-routes/contracts/deposit/
 * DepositAddress_CCTPMint_GatewayERC20.sol`.) The burn is fulfilled LOCALLY on the source chain
 * (`destChain == block.chainid` in that contract), so this recipe's intent destination IS its
 * source chain; Circle mints the USDC on the real target chain asynchronously afterwards.
 */
import type { Abi, ContractsConfig } from "@eco-incorp/sauce-compiler";

import type { ChainRef } from "../chains/canonical.js";
import { openRoute, type BuiltIntent, type RewardArg } from "../routes/intent-dsl.js";
import type { AddressInput, Hex, TokenAmountInput } from "../routes/types.js";

/**
 * Circle CCTP DOMAIN ids (NOT EVM chain ids) for the common EVM destinations — the `destinationDomain`
 * argument of `depositForBurn`. Pass a raw number for any domain not listed.
 * Source: Circle CCTP supported-domains table.
 */
export const CCTP_DOMAIN = {
  ethereum: 0,
  avalanche: 1,
  optimism: 2,
  arbitrum: 3,
  base: 6,
  polygon: 7,
  unichain: 10,
} as const;

/** Minimal ABI: ERC20 `approve` (the burn's token-approval leg). */
const IERC20_ABI: Abi = [
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
];

/**
 * Minimal ABI: CCTP v2 `TokenMessenger.depositForBurn` — the exact 7-arg signature eco-routes'
 * `DepositAddress_CCTPMint_GatewayERC20.sol` calls
 * (`depositForBurn(uint256,uint32,bytes32,address,bytes32,uint256,uint32)`).
 */
const ITOKENMESSENGER_ABI: Abi = [
  {
    type: "function",
    name: "depositForBurn",
    stateMutability: "nonpayable",
    inputs: [
      { name: "amount", type: "uint256" },
      { name: "destinationDomain", type: "uint32" },
      { name: "mintRecipient", type: "bytes32" },
      { name: "burnToken", type: "address" },
      { name: "destinationCaller", type: "bytes32" },
      { name: "maxFee", type: "uint256" },
      { name: "minFinalityThreshold", type: "uint32" },
    ],
    outputs: [{ name: "nonce", type: "uint64" }],
  },
];

/** The inline ABIs the route body's `.at()` bindings resolve against (crosses the RS `inlineContracts` boundary). */
export const CCTP_CONTRACTS: ContractsConfig = {
  IERC20: { abi: IERC20_ABI },
  ITokenMessenger: { abi: ITOKENMESSENGER_ABI },
};

/** Ceiling on the number of chunks a single stitched program may carry (keeps bytecode bounded). */
export const MAX_CCTP_CHUNKS = 64;

export interface CctpSplitParams {
  /** The chain where USDC lives and is burned (the burn is fulfilled locally, so this is also the
   *  intent's `source`). */
  readonly sourceChain: ChainRef;
  /** Total USDC (in its own decimals, 6 for USDC) to bridge. */
  readonly totalAmount: bigint;
  /** Circle's per-message burn cap on `sourceChain` — the reason the transfer must be split. */
  readonly perMessageLimit: bigint;
  /** USDC token address on `sourceChain`. */
  readonly usdc: AddressInput;
  /** CCTP v2 `TokenMessenger` address on `sourceChain`. */
  readonly tokenMessenger: AddressInput;
  /** Circle CCTP domain id of the TARGET chain (see {@link CCTP_DOMAIN}). */
  readonly destinationDomain: number;
  /** Who receives the minted USDC on the target chain (encoded as `bytes32` — a left-padded address). */
  readonly mintRecipient: AddressInput;
  /** CCTP fast-deposit `maxFee` charged per chunk (deducted on the destination). */
  readonly maxFeePerChunk: bigint;
  /** CCTP `minFinalityThreshold` (0 = fast finality). Default 0. */
  readonly minFinalityThreshold?: number;

  // ---- intent wiring (forwarded to the DSL) ----
  readonly pot: AddressInput;
  readonly portal: AddressInput;
  readonly sourcePortal?: AddressInput;
  readonly deadline: bigint | number | string;
  readonly rewardDeadline?: bigint | number | string;
  readonly creator: AddressInput;
  readonly prover: AddressInput;
  /** The reward paid to the solver that fulfills the burn (see `.reward()`). */
  readonly reward: RewardArg;
  /** The solver's delivered-token obligation (typically the total USDC) — `route.tokens`. */
  readonly routeTokens?: readonly TokenAmountInput[];
  readonly salt?: Hex;
}

/** SauceScript bigint literal for an address / amount / small int. Decimal is unambiguous. */
function lit(value: AddressInput | bigint | number): string {
  if (typeof value === "bigint") return `${value}n`;
  if (typeof value === "number") return `${BigInt(value)}n`;
  return `${BigInt(value)}n`;
}

/**
 * Splits `total` into consecutive chunks each `<= limit` (the last is the remainder). `$2` at a
 * `$1` per-message limit → `[1_000_000, 1_000_000]`.
 */
export function splitIntoChunks(total: bigint, limit: bigint): bigint[] {
  if (limit <= 0n) throw new Error("cctp-split: perMessageLimit must be > 0");
  if (total <= 0n) throw new Error("cctp-split: totalAmount must be > 0");
  const chunks: bigint[] = [];
  let remaining = total;
  while (remaining > 0n) {
    const chunk = remaining > limit ? limit : remaining;
    chunks.push(chunk);
    remaining -= chunk;
  }
  if (chunks.length > MAX_CCTP_CHUNKS) {
    throw new Error(
      `cctp-split: ${chunks.length} chunks exceeds MAX_CCTP_CHUNKS (${MAX_CCTP_CHUNKS}); raise perMessageLimit or lower totalAmount`,
    );
  }
  return chunks;
}

/**
 * Generates the Sauce route program (SauceScript source) that burns every chunk in `chunks`:
 * one `approve` + `depositForBurn` pair per chunk, then `return 0n;` (the RS compiler requires
 * `main` to return on every path — the return value is unused by `cook`). A single program with
 * N statement pairs is ONE cook, hence atomic.
 */
export function cctpSplitProgram(chunks: readonly bigint[], params: CctpSplitParams): string {
  const usdc = lit(params.usdc);
  const tm = lit(params.tokenMessenger);
  const domain = lit(params.destinationDomain);
  const recipient = lit(params.mintRecipient);
  const maxFee = lit(params.maxFeePerChunk);
  const minFinality = lit(params.minFinalityThreshold ?? 0);

  const body = chunks
    .map(
      (amount) =>
        `  IERC20.at(${usdc}).approve(${tm}, ${amount}n);\n` +
        `  ITokenMessenger.at(${tm}).depositForBurn(${amount}n, ${domain}, ${recipient}, ${usdc}, 0n, ${maxFee}, ${minFinality});`,
    )
    .join("\n");

  return `function main() {\n${body}\n  return 0n;\n}`;
}

/** Common `IntentOptions` shared by both builders. */
function intentOptions(params: CctpSplitParams, salt?: Hex) {
  return {
    pot: params.pot,
    portal: params.portal,
    sourcePortal: params.sourcePortal,
    deadline: params.deadline,
    rewardDeadline: params.rewardDeadline,
    source: params.sourceChain,
    creator: params.creator,
    prover: params.prover,
    tokens: params.routeTokens,
    salt: salt ?? params.salt,
    // The whole point: compile the route body through the Rust compiler, with the CCTP ABIs inline.
    compile: { compiler: "rs" as const, contracts: CCTP_CONTRACTS },
  };
}

/**
 * THE STITCHED (atomic) build: ONE intent whose route program burns every chunk in a single cook.
 * If any chunk reverts, the whole source-chain fulfillment reverts. This is the recommended shape
 * for splitting one large transfer across many CCTP messages.
 */
export function buildCctpSplitIntent(params: CctpSplitParams): BuiltIntent {
  const chunks = splitIntoChunks(params.totalAmount, params.perMessageLimit);
  const program = cctpSplitProgram(chunks, params);
  return openRoute(params.sourceChain, program, intentOptions(params)).reward(params.reward);
}

/**
 * THE NAIVE (non-atomic) baseline, for contrast: N INDEPENDENT intents, one `depositForBurn` each.
 * These settle separately — one can succeed while another fails — so the transfer is NOT
 * all-or-nothing. Each still compiles through the RS compiler; only the atomicity differs. A unique
 * per-index salt keeps the intents distinct.
 */
export function buildNaiveCctpIntents(params: CctpSplitParams): BuiltIntent[] {
  const chunks = splitIntoChunks(params.totalAmount, params.perMessageLimit);
  return chunks.map((amount, i) => {
    const program = cctpSplitProgram([amount], params);
    const salt = (params.salt ?? "0x") === "0x" ? undefined : params.salt;
    return openRoute(params.sourceChain, program, intentOptions(params, saltForIndex(salt, i))).reward(params.reward);
  });
}

/** Derives a distinct salt per naive-split index so the N intents don't collide (hash to the same id). */
function saltForIndex(base: Hex | undefined, i: number): Hex {
  const n = BigInt(base ?? "0x0") + BigInt(i);
  return `0x${n.toString(16).padStart(64, "0")}` as Hex;
}
