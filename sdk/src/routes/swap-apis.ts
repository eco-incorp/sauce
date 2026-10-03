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
 * ECO-SWAP. `GET /swap?embed=1&…` answers `{ embed: { … } }`: a program compiled by the compiler this
 * SDK pairs with, whose `main(amountIn, minOut)` swaps exactly `amountIn` already in the Pot, leaves
 * the output there and returns it. The contract is the SDK's (see `EcoEmbed`); eco-swap's current
 * `/swap` answers a whole cook for the old Pot instead, and does not meet it yet.
 */
import { getAddress, type Hex } from "viem";

import { requireChain } from "../chains/canonical.js";
import { v12DeployedAddresses } from "../deployments/index.js";
import {
  kyberRouterOn,
  swapRequestKey,
  swapRouteError,
  type EcoRoute,
  type KyberRoute,
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

/** Where `kyberSwap` and `ecoSwap` get their routes. */
export interface SwapApis {
  readonly kyber?: KyberApi;
  readonly eco?: EcoApi;
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
    readonly provider: "kyber" | "eco",
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
    [...unique.values()].map((request) =>
      request.provider === "kyber" ? kyberRoute(request, apis) : ecoRoute(request, apis),
    ),
  );
}

/** `url` with `path` after it, one slash between. */
const join = (url: string, path: string): string => `${url.replace(/\/+$/, "")}/${path}`;

/** A JSON answer, or the provider's refusal. The URL is not repeated in a message: eco-swap's may
 *  be a private one. */
async function fetchJson(
  provider: "kyber" | "eco",
  apis: SwapApis,
  url: string,
  init: RequestInit,
): Promise<unknown> {
  const name = provider === "kyber" ? "KyberSwap" : "eco-swap";
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

const stringField = (value: unknown, what: string, provider: "kyber" | "eco"): string => {
  if (typeof value !== "string" || value === "") {
    throw new SwapApiError(provider, `the answer has no ${what}`);
  }

  return value;
};

const integerField = (value: unknown, what: string, provider: "kyber" | "eco"): bigint => {
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
