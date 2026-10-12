/**
 * `kyberSwap(tokenIn, tokenOut, amountIn, minOut)`, `jupiterSwap(...)` and `ecoSwap(...)` — a swap
 * whose route a service builds while the program compiles, put into the program as bytes. Each
 * returns the amount of `tokenOut` delivered to the Pot and reverts below `minOut`, so a
 * `try { … } catch { … }` around one falls back to another venue.
 *
 * ```js
 * function main(recipient: Address, minOut: Uint256) {
 *   let filled = true;
 *   try {
 *     const out = kyberSwap(USDC, WETH, 1000000000, minOut);
 *     WETH.transfer(recipient, out);
 *   } catch {
 *     filled = false;
 *   }
 *   if (!filled) {
 *     const out = ecoSwap(USDC, WETH, 1000000000, minOut);
 *     WETH.transfer(recipient, out);
 *   }
 * }
 * ```
 *
 * WHAT THE COMPILER IS TOLD. The three names are `@sauce/swap`'s, an ambient module every compile
 * is handed, so a program calls them with no `import`. Each is an arrow function the compiler runs
 * at its call, which reads its route with `globalIn(scope, name)`: `scope` is the request — the
 * provider, the chain the call runs on (its names module's `chainId`), the tokens and, for a route
 * that fixes it, the amount — and the compiler asks the host's `programOptions` for the program that
 * scope's globals live in. The SDK answers with a module of its own writing that holds the route
 * ({@link routeModuleSource}), so the route reaches the program as constants and nothing in the
 * program's text is generated or rewritten. `minOut`, and eco-swap's amount, stay what the program
 * gives: the library writes them into the route as it runs.
 *
 * TWO PASSES, because the compiler's callbacks are synchronous and a route is an HTTP request. The
 * first compile answers each scope with a placeholder module and reports it as a `SwapRequest`
 * (`placeholders`); the SDK fetches each route (`swap-apis.ts#fetchSwapRoutes`); the second compile
 * answers with them (`routes`). A route is found by its request, not by the call's place, so a
 * program compiled again around the same calls (a funding wrapper) finds the same routes.
 * `sauce-route.ts#compileSauceProgramAsync` runs both.
 *
 * WHAT A ROUTE MUST BE, checked again when it is bound, whoever fetched it: KyberSwap's is a
 * `swap(...)` of the registry's `Kyberswap.MetaAggregationRouterV2` on that chain, of exactly
 * `amountIn` of `tokenIn` for `tokenOut`, paid to the Pot, with no fee taken; eco-swap's is a
 * program for `main(amountIn, minOut)`.
 *
 * ON SOLANA, a route is one instruction (Jupiter's aggregator `route` or `shared_accounts_route`,
 * or eco-swap's merge program) whose one signer is the Pot. Its accounts ride as the cook's
 * remaining accounts, with their flags and lookup tables (`svmSwapTail`), and `@sauce/swap`'s SVM
 * arm passes the whole tail to the call — so a program on Solana makes one routed swap. The module
 * holds the instruction's data cut where the floor goes (and eco-swap's amount), and the program's
 * and output account's places in the tail: Jupiter's quoted output is set to `minOut` with no
 * slippage, eco-swap's amount and floor go where its contract says, each a little-endian u64.
 *
 * WHICH POT. Kyber's calldata and a Solana route's instruction name who pays and who receives: the
 * Pot the program runs on. A top-level program's is the caller's (`swap.pot`); an intent body's is
 * the destination's shared Pot, as `intent-pot.ts` derives it for the intent's cook.
 */
import type { ProgramOptions, ProgramScope } from "sauce-compiler";
import { getAddressDecoder } from "@solana/kit";
import { bytesToHex, decodeFunctionData, getAddress, hexToBytes, type Hex } from "viem";

import { chainById, requireChain, type CanonicalChain } from "../chains/canonical.js";
import { addressOn } from "../descriptors/query.js";
import { KyberSwapMetaAggregationRouterABI } from "../protocols/kyberswap/abis.js";
import {
  JUPITER_AGGREGATOR_PROGRAM_ID,
  jupiterRouteData,
} from "../svm/venues/jupiter-aggregator/index.js";
import { resolveNamespace } from "./accessor-index.js";
import { denormalizeToEvm } from "./encode.js";
import { toUniversalAddress } from "./normalize.js";
import { pascalOfSlug } from "./pascal.js";
import type { AddressInput } from "./types.js";

/** A provider of routes: KyberSwap and eco-swap on EVM chains, Jupiter and eco-swap on Solana. */
export type SwapProvider = "kyber" | "eco" | "jupiter";

/** The provider each name a program calls asks. */
export const SWAP_FUNCTIONS: Readonly<Record<string, SwapProvider>> = {
  kyberSwap: "kyber",
  ecoSwap: "eco",
  jupiterSwap: "jupiter",
};

/** The function a program calls each provider by. */
export const SWAP_FUNCTION_OF: Readonly<Record<SwapProvider, string>> = {
  kyber: "kyberSwap",
  eco: "ecoSwap",
  jupiter: "jupiterSwap",
};

/** One swap a program makes, as its provider is asked for a route. Tokens and the Pot are
 *  checksummed `0x` addresses on an EVM chain, base58 keys on Solana. */
export interface SwapRequest {
  readonly provider: SwapProvider;
  readonly chainId: number;
  readonly tokenIn: string;
  readonly tokenOut: string;
  /** The amount the route swaps: KyberSwap's and Jupiter's, which their routes fix. eco-swap is
   *  asked for a route of any amount, which the program gives it as it runs. */
  readonly amountIn?: bigint;
  /** The Pot the program runs on. Required for KyberSwap, Jupiter and eco-swap on Solana, whose
   *  routes name it. */
  readonly pot?: string;
}

/** KyberSwap's route: its router's `swap(...)` calldata, built for the request's Pot. */
export interface KyberRoute {
  readonly provider: "kyber";
  readonly request: SwapRequest;
  readonly router: Hex;
  readonly data: Hex;
  /** What KyberSwap quoted for the route, in `tokenOut`'s base units. */
  readonly quotedOut: bigint;
  /** The last second the router takes the calldata, Unix seconds. */
  readonly deadline: bigint;
}

/** eco-swap's route on an EVM chain: a program for `main(amountIn, minOut)`, compiled by the SDK's
 *  compiler. */
export interface EcoRoute {
  readonly provider: "eco";
  readonly request: SwapRequest;
  readonly program: Hex;
  /** What eco-swap quoted, when it says. */
  readonly quotedOut?: bigint;
}

/** One account of a Solana instruction, with the role the instruction gives it. */
export interface SvmRouteAccount {
  readonly pubkey: string;
  readonly isSigner: boolean;
  readonly isWritable: boolean;
}

/** One instruction a Solana route is: what the program CPIs, the Pot signing as its authority. */
export interface SvmRouteInstruction {
  readonly programId: string;
  readonly accounts: readonly SvmRouteAccount[];
  readonly data: Hex;
  /** Address lookup tables the transaction carrying it needs to fit. */
  readonly lookupTables: readonly string[];
  /** Where among `accounts` the program the instruction calls is: the CPI's callee. */
  readonly programIndex: number;
  /** Where among `accounts` the Pot's token account for `tokenOut` is: what the swap pays. */
  readonly outputIndex: number;
  /** That account's token program: SPL Token or Token-2022. */
  readonly outputTokenProgram: string;
}

/** Jupiter's route on Solana: its aggregator's `route` or `shared_accounts_route` instruction,
 *  built for the Pot. */
export interface JupiterRoute extends SvmRouteInstruction {
  readonly provider: "jupiter";
  readonly request: SwapRequest;
  /** What Jupiter quoted, in `tokenOut`'s base units. */
  readonly quotedOut: bigint;
}

/** eco-swap's route on Solana: one instruction into its merge program, the Pot as authority, with
 *  where the program writes its amount and floor into the data. */
export interface EcoSvmRoute extends SvmRouteInstruction {
  readonly provider: "eco";
  readonly request: SwapRequest;
  /** Byte offsets of the little-endian u64 `amountIn` and `minOut` in `data`. */
  readonly offsets: { readonly amountIn: number; readonly minOut: number };
  readonly quotedOut?: bigint;
}

export type SwapRoute = KyberRoute | EcoRoute | JupiterRoute | EcoSvmRoute;

/** One request a compiled program makes, and the route bound for it. */
export interface SwapSite {
  readonly request: SwapRequest;
  /** Whether it is made by an intent's body, on the destination's shared Pot, rather than by the
   *  program itself. */
  readonly inBody: boolean;
  /** Absent where a placeholder was bound (`placeholders`). */
  readonly route?: SwapRoute;
}

/** What a compile's swaps are bound with. */
export interface SwapBindOptions {
  /** The Pot the program runs on: a route's payer and recipient (a `0x` address on an EVM chain,
   *  a base58 key on Solana). An intent body's is its destination's shared Pot instead. */
  readonly pot?: AddressInput | string;
  /** The routes fetched for this program (`fetchSwapRoutes`), each found by its request. */
  readonly routes?: readonly SwapRoute[];
  /** Bind a placeholder where a route is missing, and report the call, rather than refusing it:
   *  the first pass of a compile that then fetches the routes, or one that only looks. */
  readonly placeholders?: boolean;
}

/** A request's identity: what its route is found by. */
export function swapRequestKey(request: SwapRequest): string {
  // A `0x` address is the same in any case; a base58 key is not.
  const key = (value: string): string => (value.startsWith("0x") ? value.toLowerCase() : value);

  return [
    request.provider,
    request.chainId,
    key(request.tokenIn),
    key(request.tokenOut),
    request.amountIn ?? "any",
    request.pot === undefined ? "-" : key(request.pot),
  ].join(":");
}

/** The registry's `Kyberswap.MetaAggregationRouterV2` on `chain`, or `undefined` where it has none. */
export function kyberRouterOn(chain: CanonicalChain): Hex | undefined {
  const namespace = resolveNamespace(pascalOfSlug("kyberswap"));
  const descriptor =
    namespace?.kind === "protocol" ? namespace.contracts.get("MetaAggregationRouterV2") : undefined;
  const address = descriptor === undefined ? undefined : addressOn(descriptor, chain);

  return address === undefined ? undefined : (getAddress(address) as Hex);
}

/** How a call is named in a refusal: `kyberSwap(USDC → WETH)` reads better than the request. */
const callOf = (request: SwapRequest): string =>
  `${SWAP_FUNCTION_OF[request.provider]}(${request.tokenIn} -> ${request.tokenOut})`;

/**
 * Why `route` cannot be bound for `request` on `chain`, or `undefined` when it can: the checks a
 * route passes however it was fetched.
 */
export function swapRouteError(
  route: SwapRoute,
  request: SwapRequest,
  chain: CanonicalChain,
): string | undefined {
  if (route.provider !== request.provider) return `the route is ${route.provider}'s`;
  if (swapRequestKey(route.request) !== swapRequestKey(request)) {
    return "the route was built for another request";
  }
  if ("programId" in route) return svmRouteError(route, request);
  if (route.provider === "eco") {
    return /^0x(?:[0-9a-fA-F]{2})+$/.test(route.program) ? undefined : "its program is no bytes";
  }
  const router = kyberRouterOn(chain);
  if (router === undefined) return `the registry records no KyberSwap router on ${chain.slug}`;
  if (getAddress(route.router) !== router) {
    return `its router ${route.router} is not the registry's Kyberswap.MetaAggregationRouterV2 on ${chain.slug}, ${router}`;
  }
  let decoded: ReturnType<typeof decodeFunctionData<typeof KyberSwapMetaAggregationRouterABI>>;
  try {
    decoded = decodeFunctionData({ abi: KyberSwapMetaAggregationRouterABI, data: route.data });
  } catch {
    return "its calldata is not the router's `swap(...)`";
  }
  const { desc } = decoded.args[0];
  const same = (a: string, b: string | undefined) =>
    b !== undefined && a.toLowerCase() === b.toLowerCase();
  if (!same(desc.srcToken, request.tokenIn) || !same(desc.dstToken, request.tokenOut)) {
    return `it swaps ${desc.srcToken} for ${desc.dstToken}`;
  }
  if (desc.amount !== request.amountIn) return `it swaps ${desc.amount}, not ${request.amountIn}`;
  if (!same(desc.dstReceiver, request.pot)) {
    return `it pays ${desc.dstReceiver}, not the Pot ${request.pot}`;
  }
  if (desc.feeReceivers.length > 0) return "it pays a fee to someone";
  if (desc.permit !== "0x") return "it carries a permit; the program approves the router instead";
  const floor = kyberFloorOffset(hexToBytes(route.data));
  if (floor === undefined || wordAt(hexToBytes(route.data), floor) !== desc.minReturnAmount) {
    return "its floor (`minReturnAmount`) is not where the router's ABI puts it";
  }

  return undefined;
}

/**
 * What a Solana route's instruction must be, checked from the instruction alone: the Pot its one
 * signer, as the authority the program signs for, and, for Jupiter, its aggregator's `route` or
 * `shared_accounts_route` of exactly `amountIn` into `tokenOut`, with no platform fee. That the
 * token accounts are the Pot's needs their programs, which `swap-apis.ts` reads before it returns a
 * route.
 */
export function svmRouteError(
  route: JupiterRoute | EcoSvmRoute,
  request: SwapRequest,
): string | undefined {
  if (request.pot === undefined) return "it is not built for a Pot";
  const signers = route.accounts.filter((account) => account.isSigner);
  if (signers.length === 0 || signers.some((account) => account.pubkey !== request.pot)) {
    return `its signers are ${signers.map((account) => account.pubkey).join(", ") || "none"}, not the Pot ${request.pot} alone`;
  }
  if (!/^0x(?:[0-9a-fA-F]{2})*$/.test(route.data)) return "its data is not bytes";
  const data = hexToBytes(route.data);
  if (route.accounts[route.programIndex]?.pubkey !== route.programId) {
    return `its accounts do not include its program ${route.programId}, which the call is made through`;
  }
  const output = route.accounts[route.outputIndex];
  if (output === undefined || !output.isWritable || output.pubkey === request.pot) {
    return "its output account is not a writable account of the Pot's";
  }
  if (route.provider === "eco") {
    const { amountIn, minOut } = route.offsets;
    const fits = (at: number) => Number.isSafeInteger(at) && at >= 0 && at + 8 <= data.length;
    if (!fits(amountIn) || !fits(minOut)) {
      return "its amount and floor offsets are not inside its data";
    }
    return Math.abs(amountIn - minOut) < 8 ? "its amount and floor overlap in its data" : undefined;
  }
  if (route.programId !== JUPITER_AGGREGATOR_PROGRAM_ID) {
    return `its program ${route.programId} is not Jupiter's aggregator, ${JUPITER_AGGREGATOR_PROGRAM_ID}`;
  }
  const decoded = jupiterRouteData(data);
  if (decoded === undefined) return "it is not the aggregator's `route` or `shared_accounts_route`";
  if (decoded.inAmount !== request.amountIn) {
    return `it swaps ${decoded.inAmount}, not ${request.amountIn}`;
  }
  if (decoded.platformFeeBps !== 0) return "it pays a platform fee";
  const at = (index: number) => route.accounts[index];
  if (at(decoded.accounts.authority)?.pubkey !== request.pot) {
    return "its transfer authority is not the Pot";
  }
  if (at(decoded.accounts.destinationMint)?.pubkey !== request.tokenOut) {
    return `it swaps into ${at(decoded.accounts.destinationMint)?.pubkey}, not ${request.tokenOut}`;
  }
  if (route.outputIndex !== decoded.accounts.destination) {
    return "its output account is not the instruction's destination";
  }

  return undefined;
}

/** The 32-byte word at `at` in `data`, or `undefined` past its end. */
function wordAt(data: Uint8Array, at: number): bigint | undefined {
  if (!Number.isSafeInteger(at) || at < 0 || at + 32 > data.length) return undefined;
  let word = 0n;
  for (let i = at; i < at + 32; i++) word = (word << 8n) | BigInt(data[i]!);

  return word;
}

/**
 * Where a KyberSwap `swap(...)` call's floor, `desc.minReturnAmount`, sits in its calldata: the
 * selector, then the head of the one tuple parameter, then `desc`'s offset as that tuple's fourth
 * word, then the floor as `desc`'s ninth (`srcToken`, `dstToken`, four list offsets, `dstReceiver`,
 * `amount`, `minReturnAmount`), as the registry's ABI lays them out. The program writes its own
 * `minOut` there, so the router holds the same floor it does.
 */
export function kyberFloorOffset(data: Uint8Array): number | undefined {
  const tuple = wordAt(data, 4);
  if (tuple === undefined || tuple > BigInt(data.length)) return undefined;
  const start = 4 + Number(tuple);
  const desc = wordAt(data, start + 3 * 32);
  if (desc === undefined || desc > BigInt(data.length)) return undefined;
  const floor = start + Number(desc) + 8 * 32;

  return floor + 32 <= data.length ? floor : undefined;
}

/**
 * The names a route module exports, which `@sauce/swap` reads with `globalIn`. Spelled so no
 * program's define or name takes them: a define replaces a module constant of its name in every
 * module, and the host hands the route's program none.
 */
export const ROUTE_EXPORTS = {
  /** EVM: the contract the calldata calls (KyberSwap's router). */
  router: "__sauce_swap_router",
  /** The route's bytes before the first value the program writes into them. */
  head: "__sauce_swap_head",
  /** Between eco-swap's amount and floor on Solana, the bytes between the two. */
  middle: "__sauce_swap_middle",
  /** The route's bytes after the last value the program writes. */
  tail: "__sauce_swap_tail",
  /** EVM: eco-swap's program. */
  program: "__sauce_swap_program",
  /** Solana: where the instruction's program and the Pot's output account sit in the tail. */
  callee: "__sauce_swap_callee",
  output: "__sauce_swap_output",
  /** Solana, eco-swap: whether its amount comes before its floor in the data. */
  amountFirst: "__sauce_swap_amount_first",
} as const;

const hexLiteral = (bytes: Uint8Array): string => `hex\`${bytesToHex(bytes).slice(2)}\``;

/**
 * The module the SDK answers a swap's scope with: its route, as constants `@sauce/swap` reads.
 * The bytes are cut where the program writes a value as it runs — KyberSwap's floor, Jupiter's
 * quoted output (its slippage set to zero), eco-swap's amount and floor on Solana — so the library
 * joins them around those values. With no route (a first pass), empty placeholders.
 */
export function routeModuleSource(provider: SwapProvider, route: SwapRoute | undefined): string {
  const lines = (values: Record<string, string>) =>
    Object.entries(values)
      .map(([name, value]) => `export const ${name} = ${value};`)
      .join("\n");
  const empty = "hex``";
  if (route === undefined) {
    return provider === "kyber"
      ? lines({
          [ROUTE_EXPORTS.router]: "0",
          [ROUTE_EXPORTS.head]: empty,
          [ROUTE_EXPORTS.tail]: empty,
        })
      : provider === "jupiter"
        ? lines({
            [ROUTE_EXPORTS.callee]: "0",
            [ROUTE_EXPORTS.output]: "0",
            [ROUTE_EXPORTS.head]: empty,
            [ROUTE_EXPORTS.tail]: empty,
          })
        : lines({
            [ROUTE_EXPORTS.program]: empty,
            [ROUTE_EXPORTS.callee]: "0",
            [ROUTE_EXPORTS.output]: "0",
            [ROUTE_EXPORTS.amountFirst]: "true",
            [ROUTE_EXPORTS.head]: empty,
            [ROUTE_EXPORTS.middle]: empty,
            [ROUTE_EXPORTS.tail]: empty,
          });
  }
  if (route.provider === "kyber") {
    const data = hexToBytes(route.data);
    const floor = kyberFloorOffset(data)!;
    return lines({
      [ROUTE_EXPORTS.router]: route.router,
      [ROUTE_EXPORTS.head]: hexLiteral(data.subarray(0, floor)),
      [ROUTE_EXPORTS.tail]: hexLiteral(data.subarray(floor + 32)),
    });
  }
  if (!("programId" in route)) {
    return lines({ [ROUTE_EXPORTS.program]: hexLiteral(hexToBytes(route.program)) });
  }
  const data = hexToBytes(route.data);
  const places = {
    [ROUTE_EXPORTS.callee]: String(route.programIndex),
    [ROUTE_EXPORTS.output]: String(route.outputIndex),
  };
  if (route.provider === "jupiter") {
    // The aggregator's own floor is its quoted output at its slippage: the program's `minOut` at none.
    const { offsets } = jupiterRouteData(data)!;
    const tail = Uint8Array.from(data.subarray(offsets.slippageBps));
    tail.set([0, 0], 0);
    return lines({
      ...places,
      [ROUTE_EXPORTS.head]: hexLiteral(data.subarray(0, offsets.quotedOutAmount)),
      [ROUTE_EXPORTS.tail]: hexLiteral(tail),
    });
  }
  const { amountIn, minOut } = route.offsets;
  const [first, second] = amountIn < minOut ? [amountIn, minOut] : [minOut, amountIn];
  return lines({
    ...places,
    [ROUTE_EXPORTS.program]: empty,
    [ROUTE_EXPORTS.amountFirst]: String(amountIn < minOut),
    [ROUTE_EXPORTS.head]: hexLiteral(data.subarray(0, first)),
    [ROUTE_EXPORTS.middle]: hexLiteral(data.subarray(first + 8, second)),
    [ROUTE_EXPORTS.tail]: hexLiteral(data.subarray(second + 8)),
  });
}

/** One level's swaps: the calls a compile for `chain` makes, at any depth. */
export interface SwapLevel {
  /** The chain the program runs on. */
  readonly chain: CanonicalChain;
  readonly options: SwapBindOptions;
  /** The shared Pot an intent's body cooks on, on `destination`. */
  readonly bodyPot: (destination: CanonicalChain) => string;
}

/** Why a swap cannot be bound: the compile fails at the call, with this message. */
export class SwapError extends Error {}

const fail = (message: string): never => {
  throw new SwapError(message);
};

/** A 32-byte key, as Solana writes it: base58. */
const keyOf = (value: bigint): string =>
  getAddressDecoder().decode(hexToBytes(`0x${value.toString(16).padStart(64, "0")}`));

const addressOf = (value: bigint): Hex =>
  getAddress(`0x${value.toString(16).padStart(40, "0")}`) as Hex;

/**
 * The define each program is compiled with: 1 in an intent body's program, which cooks on the
 * destination's shared Pot, and 0 in the program the compile was given, which runs on `swap.pot`.
 * `@sauce/swap` names it in every scope, so a body on the root's own chain (Base, then Base again)
 * is told apart from the root, and the two never share a request or a route.
 */
export const SWAP_BODY_DEFINE = "__sauce_body";

/** A scope `@sauce/swap` names a route by: `{ swap, chainId, body, tokenIn, tokenOut, amountIn? }`. */
const isSwapScope = (scope: ProgramScope): scope is { readonly [field: string]: ProgramScope } =>
  typeof scope === "object" &&
  !Array.isArray(scope) &&
  typeof (scope as Record<string, ProgramScope>).swap === "string";

/**
 * The host half: the program each swap's scope is answered with, the module holding its route, and
 * every request the compile made. `answer` returns `undefined` for a scope that is not a swap's.
 * A swap it refuses fails the compile at the call; `refusal` is that refusal, as the host said it.
 */
export function swapHost(level: SwapLevel): {
  readonly answer: (
    scope: ProgramScope,
    modules: Map<string, string>,
  ) => ProgramOptions | undefined;
  readonly sites: readonly SwapSite[];
  readonly refusal: SwapError | undefined;
} {
  const sites = new Map<string, SwapSite>();
  const specifiers = new Map<string, string>();
  let refusal: SwapError | undefined;

  const answer = (
    scope: ProgramScope,
    modules: Map<string, string>,
  ): ProgramOptions | undefined => {
    try {
      return answerSwap(scope, modules);
    } catch (error) {
      if (error instanceof SwapError) refusal ??= error;
      throw error;
    }
  };

  const answerSwap = (
    scope: ProgramScope,
    modules: Map<string, string>,
  ): ProgramOptions | undefined => {
    if (!isSwapScope(scope)) return undefined;
    const provider = SWAP_FUNCTIONS[`${String(scope.swap)}Swap`];
    if (provider === undefined) return fail(`@sauce/swap: no provider ${String(scope.swap)}`);
    const name = SWAP_FUNCTION_OF[provider];
    const chain = chainById(Number(scope.chainId));
    if (chain === undefined) return fail(`${name}: no chain ${String(scope.chainId)}`);
    const svm = chain.kind === "svm";
    const word = (value: ProgramScope | undefined, what: string): bigint =>
      typeof value === "bigint" ? value : fail(`${name}: ${what} must be a number`);
    const token = (value: ProgramScope | undefined, what: string): string =>
      svm ? keyOf(word(value, what)) : addressOf(word(value, what));
    const tokenIn = token(scope.tokenIn, "tokenIn");
    const tokenOut = token(scope.tokenOut, "tokenOut");
    if (tokenIn === tokenOut) fail(`${name}: tokenIn and tokenOut are the same token`);
    const amountIn = scope.amountIn === undefined ? undefined : word(scope.amountIn, "amountIn");
    // Where the program runs, as its compile was told: never inferred from the chain, which a body
    // returning to the root's chain shares with the root.
    if (scope.body !== 0n && scope.body !== 1n) {
      fail(
        `${name}: no \`${SWAP_BODY_DEFINE}\` in its scope: the SDK compiles it, not a bare compile`,
      );
    }
    const inBody = scope.body === 1n;
    const given = inBody ? level.bodyPot(chain) : level.options.pot;
    const pot =
      given === undefined
        ? undefined
        : svm
          ? String(given)
          : (getAddress(denormalizeToEvm(toUniversalAddress(given as AddressInput))) as Hex);
    const placeholders = level.options.placeholders === true;
    // A first pass reports the call without one, for its caller to say where the Pot comes from.
    if ((provider !== "eco" || svm) && pot === undefined && !placeholders) {
      fail(
        `${name}: the route is built for the Pot the program runs on, which pays and receives: ` +
          "give the Pot (`swap.pot`; the sauce command's --pot, --owner or signer)",
      );
    }
    const request: SwapRequest = {
      provider,
      chainId: chain.id,
      tokenIn,
      tokenOut,
      ...(amountIn === undefined ? {} : { amountIn }),
      ...(pot === undefined ? {} : { pot }),
    };
    const key = swapRequestKey(request);
    const route = level.options.routes?.find((one) => swapRequestKey(one.request) === key);
    if (route === undefined && !placeholders) {
      fail(
        `${callOf(request)} has no route: its provider is asked while the program compiles, ` +
          "which `compileSauceProgramAsync` (or `fetchSwapRoutes`, then `swap.routes`) does",
      );
    }
    if (route !== undefined) {
      const why = swapRouteError(route, request, chain);
      if (why !== undefined) fail(`${callOf(request)}: the route is refused: ${why}`);
    }
    if (
      svm &&
      [...sites.values()].some(
        (site) =>
          requireChain(site.request.chainId).kind === "svm" && swapRequestKey(site.request) !== key,
      )
    ) {
      fail(
        `${name}: a program on Solana makes one routed swap: its route's accounts are all the ` +
          "accounts after the program's own, and a program cannot yet take a share of them",
      );
    }
    sites.set(key, { request, inBody, ...(route === undefined ? {} : { route }) });
    let specifier = specifiers.get(key);
    if (specifier === undefined) {
      // Served as the compile's other generated modules are, a chain's names among them.
      specifier = `@sauce/chain-swap-route-${specifiers.size}`;
      specifiers.set(key, specifier);
    }
    modules.set(specifier, routeModuleSource(provider, route));

    // The route's module alone, and no define: nothing the program is given may replace its values.
    return { ambient: [specifier], defines: [] };
  };

  return {
    answer,
    get sites() {
      return [...sites.values()];
    },
    get refusal() {
      return refusal;
    },
  };
}

/**
 * A swap whose route the compiler could not name, worded for the call: its tokens, or the amount a
 * KyberSwap or Jupiter route fixes, are values the program computes as it runs, so its scope is not
 * one the compiler knows. `undefined` for any other refusal.
 */
export function swapScopeError(source: string, cause: unknown): Error | undefined {
  const diagnostics =
    (cause as { diagnostics?: readonly unknown[] } | undefined)?.diagnostics ?? [];
  for (const one of diagnostics) {
    const d = one as {
      readonly code?: string;
      readonly path?: string;
      readonly start?: { readonly offset: number };
    };
    if (d.code !== "ProgramScopeNotConstant" || d.path !== "main.js" || d.start === undefined) {
      continue;
    }
    const name = /^(kyberSwap|jupiterSwap|ecoSwap)\s*\(/.exec(source.slice(d.start.offset))?.[1];
    if (name === undefined) continue;
    const fixed = name !== "ecoSwap";

    return new Error(
      `${name}: its tokens${fixed ? " and amountIn" : ""} must be known when the program compiles, ` +
        "because the route is built then: a symbol such as USDC, or an address written in the " +
        "program" +
        (fixed
          ? `, and an amount written in it or compiled for main's arguments (--args); ecoSwap ` +
            "takes an amount the program computes"
          : ""),
      { cause },
    );
  }

  return undefined;
}

/**
 * What a cook of a program with a Solana route carries beyond what the program's own manifest
 * names: the route's accounts, in the order the program reads them after its own (the Pot attached
 * unsigned: the Kitchen signs for it), the lookup tables the route needs, and the Pot's account the
 * swap pays into, which the cook creates when it does not exist yet. Empty for a program with no
 * Solana route.
 */
export function svmSwapTail(sites: readonly SwapSite[]): {
  readonly accounts: readonly { readonly address: string; readonly writable: boolean }[];
  readonly lookupTables: readonly string[];
  readonly outputs: readonly {
    readonly account: string;
    readonly owner: string;
    readonly mint: string;
    readonly tokenProgram: string;
  }[];
} {
  const routes = sites.flatMap((site) =>
    site.route !== undefined && "programId" in site.route ? [site.route] : [],
  );

  return {
    accounts: routes.flatMap((route) =>
      route.accounts.map((account) => ({ address: account.pubkey, writable: account.isWritable })),
    ),
    lookupTables: [...new Set(routes.flatMap((route) => route.lookupTables))],
    outputs: routes.map((route) => ({
      account: route.accounts[route.outputIndex]!.pubkey,
      owner: route.request.pot!,
      mint: route.request.tokenOut,
      tokenProgram: route.outputTokenProgram,
    })),
  };
}
