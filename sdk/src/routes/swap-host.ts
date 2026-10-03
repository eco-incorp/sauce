/**
 * `kyberSwap(tokenIn, tokenOut, amountIn, minOut)` and `ecoSwap(...)` — a swap whose route a
 * service builds while the program compiles, put into the program as bytes. Each returns the amount
 * of `tokenOut` delivered to the Pot and reverts below `minOut`, so a `try { … } catch { … }` around
 * one falls back to another venue.
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
 * The fallback runs after the `try`, not in its `catch`: a `catch` block holds a few hundred bytes of
 * compiled code, and a route is bytes put where its call is.
 *
 * WHAT THE COMPILER IS TOLD. Both names are the host's, like `USDC`: functions whose one signature
 * is SITE-BOUND (`Signature.site`), so the compiler hands `bind` what it knows at each call — each
 * argument a constant or a run-time value — and calls `@sauce/swap`'s `kyber` or `eco` with what
 * `bind` returns. A run-time value reaches the library as 32 bytes the program writes as it runs (a
 * splice): a bound argument is a constant or bytes, never a plain run-time word. No source is
 * generated and nothing is parsed.
 *
 * TWO PASSES, because the compiler's callbacks are synchronous and a route is an HTTP request.
 * The first compile binds a placeholder at each call and reports every call as a `SwapRequest`
 * (`placeholders`); the SDK fetches each route (`swap-apis.ts#fetchSwapRoutes`); the second compile
 * binds them (`routes`). A route is found by its request — provider, chain, tokens, amounts and Pot
 * — not by the call's place, so a program compiled again around the same calls (a funding wrapper)
 * finds the same routes. `sauce-route.ts#compileSauceProgramAsync` runs both.
 *
 * WHAT A ROUTE MUST BE, checked again when it is bound, whoever fetched it: KyberSwap's is a
 * `swap(...)` of the registry's `Kyberswap.MetaAggregationRouterV2` on that chain, of exactly
 * `amountIn` of `tokenIn` for `tokenOut`, paid to the Pot, with no fee taken; eco-swap's is a
 * program for `main(amountIn, minOut)`.
 *
 * WHICH POT. Kyber's calldata names who pays and who receives: the Pot the program runs on. A
 * top-level program's is the caller's (`swap.pot`); an intent body's is the destination's shared
 * Pot, as `intent-pot.ts` derives it for the intent's cook.
 */
import type { BoundArgument, CallSite, Declaration, View } from "sauce-compiler";
import { decodeFunctionData, getAddress, hexToBytes, type Hex } from "viem";

import type { CanonicalChain } from "../chains/canonical.js";
import { addressOn } from "../descriptors/query.js";
import { KyberSwapMetaAggregationRouterABI } from "../protocols/kyberswap/abis.js";
import { resolveNamespace } from "./accessor-index.js";
import { pascalOfSlug } from "./builder.js";
import { denormalizeToEvm } from "./encode.js";
import { toUniversalAddress } from "./normalize.js";
import type { AddressInput } from "./types.js";

/** A provider of routes. */
export type SwapProvider = "kyber" | "eco";

/** The name a program calls each provider by. */
export const SWAP_FUNCTIONS: Readonly<Record<string, SwapProvider>> = {
  kyberSwap: "kyber",
  ecoSwap: "eco",
};

const SWAP_MODULE = "@sauce/swap";

/** One swap a program makes, as its provider is asked for a route. */
export interface SwapRequest {
  readonly provider: SwapProvider;
  readonly chainId: number;
  readonly tokenIn: Hex;
  readonly tokenOut: Hex;
  /** Known when the program compiles; else it runs with an amount it computes (eco-swap only). */
  readonly amountIn?: bigint;
  /** Known when the program compiles; else a value it computes, checked as it runs. */
  readonly minOut?: bigint;
  /** The Pot the program runs on. Required for KyberSwap, whose calldata names it. */
  readonly pot?: Hex;
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

/** eco-swap's route: a program for `main(amountIn, minOut)`, compiled by the SDK's compiler. */
export interface EcoRoute {
  readonly provider: "eco";
  readonly request: SwapRequest;
  readonly program: Hex;
  /** What eco-swap quoted, when it says. */
  readonly quotedOut?: bigint;
}

export type SwapRoute = KyberRoute | EcoRoute;

/** One call of `kyberSwap`/`ecoSwap` in a compiled program, and the route bound there. */
export interface SwapSite {
  readonly request: SwapRequest;
  /** Absent where a placeholder was bound (`placeholders`). */
  readonly route?: SwapRoute;
}

/** What a compile's swaps are bound with. */
export interface SwapBindOptions {
  /** The Pot the program runs on: KyberSwap's sender and recipient. An intent body's is its
   *  destination's shared Pot instead. */
  readonly pot?: AddressInput;
  /** The routes fetched for this program (`fetchSwapRoutes`), each found by its request. */
  readonly routes?: readonly SwapRoute[];
  /** Bind a placeholder where a route is missing, and report the call, rather than refusing it:
   *  the first pass of a compile that then fetches the routes, or one that only looks. */
  readonly placeholders?: boolean;
}

class SwapError extends Error {}

const fail = (message: string): never => {
  throw new SwapError(message);
};

/** A request's identity: what its route is found by. */
export function swapRequestKey(request: SwapRequest): string {
  return [
    request.provider,
    request.chainId,
    request.tokenIn.toLowerCase(),
    request.tokenOut.toLowerCase(),
    request.amountIn ?? "run",
    request.minOut ?? "run",
    request.pot?.toLowerCase() ?? "-",
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
  `${request.provider === "kyber" ? "kyberSwap" : "ecoSwap"}(${request.tokenIn} -> ${request.tokenOut})`;

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

/** A word as bytes: a constant now, or a run-time value the program writes as it runs. */
function wordArgument(view: View): BoundArgument {
  if ("runtime" in view) {
    return { bytes: new Uint8Array(32), splices: [{ offset: 0, runtime: view.runtime }] };
  }
  if ("constant" in view) {
    return { bytes: hexToBytes(`0x${BigInt(view.constant).toString(16).padStart(64, "0")}`) };
  }

  return fail("a swap's amounts are numbers");
}

/**
 * KyberSwap's calldata with the program's `minOut` as the router's floor: written in when the
 * program knows it, else spliced in as the program runs. KyberSwap's own floor, from the tolerance
 * it was asked for, is replaced, so the router and the program refuse the same short fill.
 */
function withFloor(route: KyberRoute, minOut: View): BoundArgument {
  const data = hexToBytes(route.data);
  const floor = kyberFloorOffset(data)!;
  if ("runtime" in minOut) {
    return { bytes: data, splices: [{ offset: floor, runtime: minOut.runtime }] };
  }
  if ("constant" in minOut) {
    data.set(hexToBytes(`0x${BigInt(minOut.constant).toString(16).padStart(64, "0")}`), floor);
    return { bytes: data };
  }

  return fail("a swap's amounts are numbers");
}

const addressOf = (value: bigint): Hex =>
  getAddress(`0x${value.toString(16).padStart(40, "0")}`) as Hex;

/** One level's swaps: `kyberSwap`/`ecoSwap` on `chain`, run by the Pot `pot` names. */
export interface SwapLevel {
  readonly chain: CanonicalChain;
  /** The Pot the level runs on, asked only when a call needs it. */
  readonly pot: () => AddressInput | undefined;
  readonly options: SwapBindOptions;
  /** Every call bound, at every level of the compile, in the order the compiler binds them. */
  readonly sites: SwapSite[];
}

/** The host half of `kyberSwap`/`ecoSwap`: declarations, the module they call, and `bind`, which
 *  answers for their calls only (`undefined` for any other site-bound call). */
export function swapHost(level: SwapLevel): {
  readonly declare: (name: string) => Declaration | undefined;
  readonly hostModules: string[];
  readonly bind: (site: CallSite) => BoundArgument[] | undefined;
} {
  const { chain } = level;
  const value = { kind: "value" } as const;

  const declare = (name: string): Declaration | undefined => {
    const provider = SWAP_FUNCTIONS[name];
    if (provider === undefined || chain.kind !== "evm") return undefined;

    return {
      kind: "function",
      signatures: [
        {
          params: [value, value, value, value],
          calls: { module: SWAP_MODULE, export: provider },
          site: true,
        },
      ],
    };
  };

  const bind = (site: CallSite): BoundArgument[] | undefined => {
    const provider = SWAP_FUNCTIONS[site.callee];
    if (provider === undefined) return undefined;
    const name = site.callee;
    const [tokenInView, tokenOutView, amountView, minOutView] = site.args;
    const constant = (view: View | undefined, what: string): bigint | undefined => {
      if (view !== undefined && "type" in view && view.type === "bool") {
        return fail(`${name}: ${what} is a \`bool\``);
      }
      if (view !== undefined && "constant" in view) return BigInt(view.constant);
      if (view !== undefined && "runtime" in view) return undefined;

      return fail(`${name}: ${what} must be a value`);
    };
    const token = (view: View | undefined, what: string): Hex => {
      const known = constant(view, what);
      if (known === undefined) {
        return fail(
          `${name}: ${what} must be known when the program compiles — a symbol such as USDC, or ` +
            "an address written in the program — because the route is built then",
        );
      }

      return addressOf(known);
    };
    const tokenIn = token(tokenInView, "tokenIn");
    const tokenOut = token(tokenOutView, "tokenOut");
    if (tokenIn === tokenOut) fail(`${name}: tokenIn and tokenOut are the same token`);
    const amountIn = constant(amountView, "amountIn");
    const minOut = constant(minOutView, "minOut");
    if (provider === "kyber" && amountIn === undefined) {
      fail(
        "kyberSwap: amountIn must be known when the program compiles, because KyberSwap's " +
          "calldata fixes the amount it swaps. Write it in the program, or compile it for main's " +
          "arguments (`--args`); ecoSwap takes an amount the program computes",
      );
    }
    const potGiven = level.pot();
    const pot =
      potGiven === undefined
        ? undefined
        : (getAddress(denormalizeToEvm(toUniversalAddress(potGiven))) as Hex);
    // A first pass reports the call without one, for its caller to say where the Pot comes from.
    if (provider === "kyber" && pot === undefined && level.options.placeholders !== true) {
      fail(
        "kyberSwap: KyberSwap builds its calldata for the Pot the program runs on, which pays " +
          "and receives: give the Pot (`swap.pot`; the sauce command's --pot, --owner or signer)",
      );
    }
    const request: SwapRequest = {
      provider,
      chainId: chain.id,
      tokenIn,
      tokenOut,
      ...(amountIn === undefined ? {} : { amountIn }),
      ...(minOut === undefined ? {} : { minOut }),
      ...(pot === undefined ? {} : { pot }),
    };
    const key = swapRequestKey(request);
    const route = level.options.routes?.find((given) => swapRequestKey(given.request) === key);
    if (route === undefined && level.options.placeholders !== true) {
      return fail(
        `${callOf(request)} has no route: its provider is asked while the program compiles, ` +
          "which `compileSauceProgramAsync` (or `fetchSwapRoutes`, then `swap.routes`) does",
      );
    }
    if (route !== undefined) {
      const why = swapRouteError(route, request, chain);
      if (why !== undefined) fail(`${callOf(request)}: the route is refused: ${why}`);
    }
    level.sites.push({ request, ...(route === undefined ? {} : { route }) });

    const tokens: BoundArgument[] = [
      { value: tokenIn, type: "Address" },
      { value: tokenOut, type: "Address" },
    ];
    if (provider === "kyber") {
      const kyber = route as KyberRoute | undefined;
      return [
        { value: kyber?.router ?? kyberRouterOn(chain) ?? "0", type: "Address" },
        ...tokens,
        { value: String(amountIn) },
        kyber === undefined ? { bytes: new Uint8Array() } : withFloor(kyber, minOutView!),
        wordArgument(minOutView!),
      ];
    }
    const eco = route as EcoRoute | undefined;

    return [
      { bytes: eco === undefined ? new Uint8Array() : hexToBytes(eco.program) },
      ...tokens,
      wordArgument(amountView!),
      wordArgument(minOutView!),
    ];
  };

  return { declare, hostModules: [SWAP_MODULE], bind };
}

export { SwapError };
