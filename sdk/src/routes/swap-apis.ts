/**
 * The services `kyberSwap` and `ecoSwap` ask for a route while a program compiles
 * (`swap-host.ts`): one request per call, over `fetch`, to the URL the caller gives. The SDK ships
 * no URL and reads no environment, so it runs the same in a browser; the `sauce` command supplies
 * KyberSwap's public endpoint itself (`cli/public-swap-apis.ts`).
 *
 * KYBERSWAP. Its aggregator API in two steps: `GET /{chain}/api/v1/routes` finds a route for
 * `amountIn`, `POST /{chain}/api/v1/route/build` encodes it for a sender and a recipient — the Pot,
 * which pays and receives. The floor KyberSwap writes into the calldata is replaced by the
 * program's own `minOut` when the route is bound (`swap-host.ts#withFloor`), so the tolerance it is
 * asked for decides nothing. RFQ sources are left out unless asked for: their quotes expire within
 * minutes and fill once, and a compiled program may run later than that, or twice.
 *
 * ECO-SWAP. `GET /swap?embed=1&…` answers `{ embed: { … } }`. On an EVM chain, a program compiled by
 * the compiler this SDK pairs with, whose `main(amountIn, minOut)` swaps exactly `amountIn` already
 * in the Pot, leaves the output there and returns it (`EcoEmbed`). On Solana, one instruction into
 * eco-swap's merge program, the Pot its one signer, with where its amount and floor sit in the data
 * (`EcoSvmEmbed`). Both contracts are the SDK's; eco-swap's current `/swap` answers a whole cook (on
 * Solana, a staged program and its execution plan) instead, and meets neither yet.
 *
 * JUPITER, on Solana. Its Swap API (v1) in two steps: `GET /swap/v1/quote` finds a route for
 * `amountIn`, `POST /swap/v1/swap-instructions` builds it for a user — the Pot, which signs as the
 * transfer authority, its token accounts the Pot's. Only the swap instruction is kept: the program
 * CPIs it, and the cook creates the Pot's output account itself. The instruction is refused unless
 * it is Jupiter's aggregator's `route` or `shared_accounts_route` of exactly `amountIn`, with the Pot
 * its one signer and its token accounts the Pot's associated accounts.
 */
import { getAddress, hexToBytes, type Hex } from "viem";

import { address } from "@solana/kit";

import { requireChain } from "../chains/canonical.js";
import { v12DeployedAddresses } from "../deployments/index.js";
import { svmTokenAccount } from "../svm/token-accounts.js";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "../svm/token-program.js";
import { jupiterRouteData } from "../svm/venues/jupiter-aggregator/index.js";
import {
  kyberRouterOn,
  svmRouteError,
  swapRequestKey,
  swapRouteError,
  type EcoRoute,
  type EcoSvmRoute,
  type JupiterRoute,
  type KyberRoute,
  type SvmRouteAccount,
  type SwapProvider,
  type SwapRequest,
  type SwapRoute,
} from "./swap-host.js";

/** KyberSwap's aggregator API. */
export interface KyberApi {
  /** Its base URL. The SDK ships none. */
  readonly url: string;
  /** Sent as `x-client-id`, which KyberSwap rate-limits by. */
  readonly clientId?: string;
  /** How long the calldata stays valid, in seconds from when it is built. Defaults to 1200. */
  readonly deadlineSeconds?: number;
  /** Take RFQ sources too, whose quotes expire within minutes and fill once. */
  readonly includeRfq?: boolean;
}

/** eco-swap's API. */
export interface EcoApi {
  /** Its base URL. It has no default. */
  readonly url: string;
}

/** Jupiter's Swap API, on Solana. */
export interface JupiterApi {
  /** Its base URL. The SDK ships none. */
  readonly url: string;
  /** The tolerance Jupiter is asked to quote with, in basis points. Defaults to 50. */
  readonly slippageBps?: number;
  /** At most this many accounts in the route, for a cook that has to fit one transaction. */
  readonly maxAccounts?: number;
  /** Pool programs to route around, by Jupiter's labels: one that refuses being reached through a
   *  CPI, or one past the depth a cook's CPIs can go. */
  readonly excludeDexes?: readonly string[];
}

/** Where `kyberSwap`, `jupiterSwap` and `ecoSwap` get their routes. */
export interface SwapApis {
  readonly kyber?: KyberApi;
  readonly eco?: EcoApi;
  readonly jupiter?: JupiterApi;
  /** Defaults to the global `fetch`. */
  readonly fetch?: typeof fetch;
  /** The time Kyber's deadline counts from, Unix seconds; defaults to the clock. */
  readonly now?: () => bigint;
  /** How long one request may take, in milliseconds. Defaults to 20000. */
  readonly timeoutMs?: number;
}

/** A provider refused, or could not be reached, or answered with something unusable. */
export class SwapApiError extends Error {
  constructor(
    readonly provider: SwapProvider,
    message: string,
  ) {
    super(message);
  }
}

/** The tolerance KyberSwap is asked to build with, in basis points. Its floor is replaced. */
const KYBER_TOLERANCE_BPS = 50;

/** KyberSwap's slug for each chain its API serves, by chain id. */
export const KYBER_CHAINS: Readonly<Record<number, string>> = {
  1: "ethereum",
  10: "optimism",
  56: "bsc",
  130: "unichain",
  137: "polygon",
  143: "monad",
  146: "sonic",
  999: "hyperevm",
  2020: "ronin",
  4326: "megaeth",
  4663: "robinhood",
  5000: "mantle",
  5042: "arc",
  8453: "base",
  9745: "plasma",
  42161: "arbitrum",
  42793: "etherlink",
  43114: "avalanche",
  59144: "linea",
  80094: "berachain",
};

/** One route per distinct request, each from its provider, in the order given. */
export async function fetchSwapRoutes(
  requests: readonly SwapRequest[],
  apis: SwapApis,
): Promise<SwapRoute[]> {
  const unique = new Map(requests.map((request) => [swapRequestKey(request), request]));

  return Promise.all(
    [...unique.values()].map((request): Promise<SwapRoute> => {
      if (request.provider === "kyber") return kyberRoute(request, apis);
      if (request.provider === "jupiter") return jupiterRoute(request, apis);
      return requireChain(request.chainId).kind === "svm"
        ? ecoSvmRoute(request, apis)
        : ecoRoute(request, apis);
    }),
  );
}

/** `url` with `path` after it, one slash between. */
const join = (url: string, path: string): string => `${url.replace(/\/+$/, "")}/${path}`;

/** A JSON answer, or the provider's refusal. The URL is not repeated in a message: eco-swap's may
 *  be a private one. */
async function fetchJson(
  provider: SwapProvider,
  apis: SwapApis,
  url: string,
  init: RequestInit,
): Promise<unknown> {
  const name = SERVICE[provider];
  const fetchOf = apis.fetch ?? globalThis.fetch;
  let response: Response;
  try {
    response = await fetchOf(url, {
      ...init,
      signal: AbortSignal.timeout(apis.timeoutMs ?? 20_000),
    });
  } catch (error) {
    throw new SwapApiError(provider, `${name} could not be reached: ${(error as Error).message}`);
  }
  const text = await response.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new SwapApiError(provider, `${name} answered ${response.status} with no JSON`);
  }
  if (!response.ok) {
    const said = (body as { message?: unknown; error?: unknown }) ?? {};
    const reason = typeof said.message === "string" ? said.message : said.error;
    throw new SwapApiError(
      provider,
      `${name} refused (${response.status}${typeof reason === "string" ? `: ${reason}` : ""})`,
    );
  }

  return body;
}

/** Each provider's name, as a message says it. */
const SERVICE: Readonly<Record<SwapProvider, string>> = {
  kyber: "KyberSwap",
  eco: "eco-swap",
  jupiter: "Jupiter",
};

const stringField = (value: unknown, what: string, provider: SwapProvider): string => {
  if (typeof value !== "string" || value === "") {
    throw new SwapApiError(provider, `the answer has no ${what}`);
  }

  return value;
};

const integerField = (value: unknown, what: string, provider: SwapProvider): bigint => {
  const text = stringField(value, what, provider);
  if (!/^\d+$/.test(text)) throw new SwapApiError(provider, `${what} is not an integer: ${text}`);

  return BigInt(text);
};

/** KyberSwap's route for `request`: found, then built for its Pot. */
export async function kyberRoute(request: SwapRequest, apis: SwapApis): Promise<KyberRoute> {
  const api = apis.kyber;
  if (api === undefined) {
    throw new SwapApiError("kyber", "kyberSwap needs KyberSwap's API: give its URL (`swap.kyber`)");
  }
  const chain = requireChain(request.chainId);
  const slug = KYBER_CHAINS[request.chainId];
  if (slug === undefined) {
    throw new SwapApiError("kyber", `KyberSwap's API serves no route on ${chain.slug}`);
  }
  const router = kyberRouterOn(chain);
  if (router === undefined) {
    throw new SwapApiError("kyber", `the registry records no KyberSwap router on ${chain.slug}`);
  }
  if (request.amountIn === undefined || request.pot === undefined) {
    throw new SwapApiError("kyber", "a KyberSwap route needs its amount and its Pot");
  }
  const headers = { "x-client-id": api.clientId ?? "sauce" };
  const query = new URLSearchParams({
    tokenIn: request.tokenIn,
    tokenOut: request.tokenOut,
    amountIn: request.amountIn.toString(),
    ...(api.includeRfq === true ? {} : { excludeRFQSources: "true" }),
  });
  const found = (await fetchJson("kyber", apis, join(api.url, `${slug}/api/v1/routes?${query}`), {
    headers,
  })) as { data?: { routeSummary?: { amountOut?: unknown }; routerAddress?: unknown } };
  const summary = found.data?.routeSummary;
  if (summary === undefined) throw new SwapApiError("kyber", "the answer has no route");
  refuseRouter(found.data?.routerAddress, router, chain.slug);
  const quoted = integerField(summary.amountOut, "amountOut", "kyber");
  if (quoted === 0n) throw new SwapApiError("kyber", "KyberSwap quotes nothing for this swap");
  const now = apis.now?.() ?? BigInt(Math.floor(Date.now() / 1000));
  const deadline = now + BigInt(api.deadlineSeconds ?? 1200);
  const built = (await fetchJson("kyber", apis, join(api.url, `${slug}/api/v1/route/build`), {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify({
      routeSummary: summary,
      sender: request.pot,
      recipient: request.pot,
      // Its floor is replaced by the program's `minOut` when the route is bound.
      slippageTolerance: KYBER_TOLERANCE_BPS,
      deadline: Number(deadline),
      source: api.clientId ?? "sauce",
    }),
  })) as {
    data?: {
      data?: unknown;
      routerAddress?: unknown;
      transactionValue?: unknown;
      amountIn?: unknown;
    };
  };
  const data = built.data;
  if (data === undefined) throw new SwapApiError("kyber", "the build answered no calldata");
  refuseRouter(data.routerAddress, router, chain.slug);
  if (integerField(data.transactionValue ?? "0", "transactionValue", "kyber") !== 0n) {
    throw new SwapApiError("kyber", "the route takes the native coin, which kyberSwap never sends");
  }
  const calldata = stringField(data.data, "calldata", "kyber") as Hex;
  const route: KyberRoute = {
    provider: "kyber",
    request,
    router,
    data: calldata,
    quotedOut: quoted,
    deadline,
  };
  const why = swapRouteError(route, request, chain);
  if (why !== undefined) throw new SwapApiError("kyber", `KyberSwap's route is refused: ${why}`);

  return route;
}

/** A Kyber answer's router, refused unless it is the registry's. */
function refuseRouter(given: unknown, router: Hex, chain: string): void {
  const address = stringField(given, "routerAddress", "kyber");
  if (!/^0x[0-9a-fA-F]{40}$/.test(address) || getAddress(address) !== router) {
    throw new SwapApiError(
      "kyber",
      `KyberSwap answered router ${address}, which is not the registry's ` +
        `Kyberswap.MetaAggregationRouterV2 on ${chain}, ${router}`,
    );
  }
}

/**
 * What eco-swap answers `GET /swap?embed=1&…` with, under `embed`: the contract a program it builds
 * meets to be put into another.
 */
export interface EcoEmbed {
  /** This contract's version: 1. */
  readonly version: 1;
  /** The compiler that compiled `program`: the one this SDK pairs with. */
  readonly compiler: string;
  readonly chainId: number;
  readonly tokenIn: string;
  readonly tokenOut: string;
  /** The program's bytecode, `0x` hex, with no arguments appended. */
  readonly program: string;
  /** `main`'s parameters as the compiler reports them: exactly two `uint256`, `amountIn` and
   *  `minOut`. */
  readonly entryParams: readonly { readonly name: string; readonly type: string }[];
  /** What the route quotes for `amountIn`, when the request gave one. */
  readonly amountOut?: string;
}

/** eco-swap's program for `request`. */
export async function ecoRoute(request: SwapRequest, apis: SwapApis): Promise<EcoRoute> {
  const api = apis.eco;
  if (api === undefined) {
    throw new SwapApiError("eco", "ecoSwap needs eco-swap's API: give its URL (`swap.eco`)");
  }
  const query = new URLSearchParams({
    embed: "1",
    chainId: String(request.chainId),
    from: request.tokenIn,
    to: request.tokenOut,
    ...(request.amountIn === undefined ? {} : { amountIn: request.amountIn.toString() }),
    ...(request.minOut === undefined ? {} : { minOut: request.minOut.toString() }),
    ...(request.pot === undefined ? {} : { pot: request.pot }),
  });
  const answer = (await fetchJson("eco", apis, join(api.url, `swap?${query}`), {})) as {
    embed?: Partial<EcoEmbed>;
  };
  const embed = answer.embed;
  if (embed === undefined) {
    throw new SwapApiError(
      "eco",
      "eco-swap answered no `embed`: it does not build programs to put into another yet",
    );
  }
  if (embed.version !== 1) {
    throw new SwapApiError("eco", `eco-swap's embed is version ${String(embed.version)}, not 1`);
  }
  const compiler = v12DeployedAddresses().compiler;
  if (embed.compiler !== compiler) {
    throw new SwapApiError(
      "eco",
      `eco-swap compiled its program with compiler ${String(embed.compiler)}; this SDK's programs ` +
        `are compiler ${compiler}'s, and an engine runs one compiler's output`,
    );
  }
  const same = (a: unknown, b: string) =>
    typeof a === "string" && a.toLowerCase() === b.toLowerCase();
  if (
    embed.chainId !== request.chainId ||
    !same(embed.tokenIn, request.tokenIn) ||
    !same(embed.tokenOut, request.tokenOut)
  ) {
    throw new SwapApiError("eco", "eco-swap answered for another chain or pair");
  }
  const params = embed.entryParams ?? [];
  if (params.length !== 2 || params.some((param) => param.type !== "uint256")) {
    throw new SwapApiError(
      "eco",
      "eco-swap's program must take `main(amountIn: Uint256, minOut: Uint256)`",
    );
  }
  const program = stringField(embed.program, "program", "eco");
  if (!/^0x(?:[0-9a-fA-F]{2})+$/.test(program)) {
    throw new SwapApiError("eco", "eco-swap's program is not hex bytes");
  }

  return {
    provider: "eco",
    request,
    program: program as Hex,
    ...(embed.amountOut === undefined
      ? {}
      : { quotedOut: integerField(embed.amountOut, "amountOut", "eco") }),
  };
}

/** An instruction's accounts as an API answers them, each checked to be a key and two flags. */
function routeAccounts(given: unknown, provider: SwapProvider): SvmRouteAccount[] {
  if (!Array.isArray(given)) throw new SwapApiError(provider, "the answer has no accounts");

  return given.map((account: unknown) => {
    const { pubkey, isSigner, isWritable } = (account ?? {}) as Record<string, unknown>;
    if (
      typeof pubkey !== "string" ||
      typeof isSigner !== "boolean" ||
      typeof isWritable !== "boolean"
    ) {
      throw new SwapApiError(
        provider,
        "an account of the answer is not { pubkey, isSigner, isWritable }",
      );
    }
    address(pubkey);

    return { pubkey, isSigner, isWritable };
  });
}

/** Base64 data as `0x` hex. */
function base64Hex(given: unknown, what: string, provider: SwapProvider): Hex {
  const text = stringField(given, what, provider);
  const binary = atob(text);
  let hex = "0x";
  for (let i = 0; i < binary.length; i++) hex += binary.charCodeAt(i).toString(16).padStart(2, "0");

  return hex as Hex;
}

/** Whether `account` is `owner`'s associated account for `mint`, under either token program. */
async function isAssociatedAccount(account: string, owner: string, mint: string): Promise<boolean> {
  for (const tokenProgram of [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID]) {
    if (
      (await svmTokenAccount({ mint: address(mint), tokenProgram }, address(owner))) === account
    ) {
      return true;
    }
  }

  return false;
}

/** Jupiter's route for `request`: quoted, then built for its Pot. */
export async function jupiterRoute(request: SwapRequest, apis: SwapApis): Promise<JupiterRoute> {
  const api = apis.jupiter;
  if (api === undefined) {
    throw new SwapApiError(
      "jupiter",
      "jupiterSwap needs Jupiter's API: give its URL (`swap.jupiter`)",
    );
  }
  if (requireChain(request.chainId).kind !== "svm") {
    throw new SwapApiError("jupiter", "jupiterSwap swaps on Solana");
  }
  if (request.amountIn === undefined || request.pot === undefined) {
    throw new SwapApiError("jupiter", "a Jupiter route needs its amount and its Pot");
  }
  const query = new URLSearchParams({
    inputMint: request.tokenIn,
    outputMint: request.tokenOut,
    amount: request.amountIn.toString(),
    slippageBps: String(api.slippageBps ?? 50),
    swapMode: "ExactIn",
    ...(api.maxAccounts === undefined ? {} : { maxAccounts: String(api.maxAccounts) }),
    ...(api.excludeDexes === undefined || api.excludeDexes.length === 0
      ? {}
      : { excludeDexes: api.excludeDexes.join(",") }),
  });
  const quote = (await fetchJson("jupiter", apis, join(api.url, `swap/v1/quote?${query}`), {})) as {
    outAmount?: unknown;
    error?: unknown;
  };
  const quoted = integerField(quote.outAmount, "outAmount", "jupiter");
  const built = (await fetchJson("jupiter", apis, join(api.url, "swap/v1/swap-instructions"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      quoteResponse: quote,
      userPublicKey: request.pot,
      // The Pot holds wrapped SOL as a token; nothing here moves native SOL.
      wrapAndUnwrapSol: false,
    }),
  })) as {
    swapInstruction?: { programId?: unknown; accounts?: unknown; data?: unknown };
    addressLookupTableAddresses?: unknown;
  };
  const instruction = built.swapInstruction;
  if (instruction === undefined)
    throw new SwapApiError("jupiter", "the answer has no swap instruction");
  const lookupTables = Array.isArray(built.addressLookupTableAddresses)
    ? built.addressLookupTableAddresses.map((table) =>
        stringField(table, "lookup table", "jupiter"),
      )
    : [];
  const route: JupiterRoute = {
    provider: "jupiter",
    request,
    programId: stringField(instruction.programId, "programId", "jupiter"),
    accounts: routeAccounts(instruction.accounts, "jupiter"),
    data: base64Hex(instruction.data, "data", "jupiter"),
    lookupTables,
    quotedOut: quoted,
  };
  const why = svmRouteError(route, request);
  if (why !== undefined) throw new SwapApiError("jupiter", `Jupiter's route is refused: ${why}`);
  // Its token accounts, read off the positions its instruction gives them: the Pot's own.
  const decoded = jupiterRouteData(hexToBytes(route.data))!;
  const source = route.accounts[decoded.accounts.source]?.pubkey ?? "";
  const destination = route.accounts[decoded.accounts.destination]?.pubkey ?? "";
  if (!(await isAssociatedAccount(source, request.pot, request.tokenIn))) {
    throw new SwapApiError("jupiter", `Jupiter's route pays from ${source}, not the Pot's account`);
  }
  if (!(await isAssociatedAccount(destination, request.pot, request.tokenOut))) {
    throw new SwapApiError(
      "jupiter",
      `Jupiter's route pays into ${destination}, not the Pot's account`,
    );
  }

  return route;
}

/**
 * What eco-swap answers `GET /swap?embed=1&…` with on Solana, under `embed`: one instruction the
 * program CPIs, the Pot its only signer.
 */
export interface EcoSvmEmbed {
  /** This contract's version: 1. */
  readonly version: 1;
  /** `"instruction"`: one instruction, not a program. */
  readonly kind: "instruction";
  readonly chainId: number;
  readonly tokenIn: string;
  readonly tokenOut: string;
  /** eco-swap's merge program. */
  readonly programId: string;
  /** Its accounts, in order, with their flags: the Pot is the one signer. */
  readonly accounts: readonly SvmRouteAccount[];
  /** The instruction's data, base64. */
  readonly data: string;
  /** Byte offsets of the little-endian u64 amount in and floor in `data`, which the program writes
   *  when it computes them. */
  readonly offsets: { readonly amountIn: number; readonly minOut: number };
  /** Address lookup tables the cook needs to fit one transaction. */
  readonly lookupTables?: readonly string[];
  /** What the route quotes for `amountIn`, when the request gave one. */
  readonly amountOut?: string;
}

/** eco-swap's instruction for `request` on Solana. */
export async function ecoSvmRoute(request: SwapRequest, apis: SwapApis): Promise<EcoSvmRoute> {
  const api = apis.eco;
  if (api === undefined) {
    throw new SwapApiError("eco", "ecoSwap needs eco-swap's API: give its URL (`swap.eco`)");
  }
  if (request.pot === undefined)
    throw new SwapApiError("eco", "an eco-swap route on Solana needs its Pot");
  const query = new URLSearchParams({
    embed: "1",
    chainId: String(request.chainId),
    from: request.tokenIn,
    to: request.tokenOut,
    ...(request.amountIn === undefined ? {} : { amountIn: request.amountIn.toString() }),
    ...(request.minOut === undefined ? {} : { minOut: request.minOut.toString() }),
    pot: request.pot,
  });
  const answer = (await fetchJson("eco", apis, join(api.url, `swap?${query}`), {})) as {
    embed?: Partial<EcoSvmEmbed>;
  };
  const embed = answer.embed;
  if (embed === undefined || embed.version !== 1 || embed.kind !== "instruction") {
    throw new SwapApiError(
      "eco",
      "eco-swap answered no `embed` of kind `instruction`: it does not build routes for another " +
        "program on Solana yet",
    );
  }
  if (
    embed.chainId !== request.chainId ||
    embed.tokenIn !== request.tokenIn ||
    embed.tokenOut !== request.tokenOut
  ) {
    throw new SwapApiError("eco", "eco-swap answered for another chain or pair");
  }
  const offsets = embed.offsets;
  if (
    offsets === undefined ||
    typeof offsets.amountIn !== "number" ||
    typeof offsets.minOut !== "number"
  ) {
    throw new SwapApiError(
      "eco",
      "eco-swap's instruction does not say where its amount and floor sit",
    );
  }
  const route: EcoSvmRoute = {
    provider: "eco",
    request,
    programId: address(stringField(embed.programId, "programId", "eco")),
    accounts: routeAccounts(embed.accounts, "eco"),
    data: base64Hex(embed.data, "data", "eco"),
    lookupTables: (embed.lookupTables ?? []).map((table) => address(table)),
    offsets: { amountIn: offsets.amountIn, minOut: offsets.minOut },
    ...(embed.amountOut === undefined
      ? {}
      : { quotedOut: integerField(embed.amountOut, "amountOut", "eco") }),
  };
  const why = svmRouteError(route, request);
  if (why !== undefined) throw new SwapApiError("eco", `eco-swap's route is refused: ${why}`);

  return route;
}
