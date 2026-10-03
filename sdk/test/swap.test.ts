/**
 * `kyberSwap(...)` and `ecoSwap(...)`: a route fetched while the program compiles, through the real
 * compiler and its host API (`routes/swap-host.ts`, `routes/swap-apis.ts`). No network: every
 * answer is a fixture served by a `fetch` the test passes.
 *
 * `fixtures/swap/kyber-base-{routes,build}.json` are KyberSwap's public aggregator API's real
 * answers, fetched once by hand on 2026-10-03: Base, 1000 USDC (1000000000) for WETH, RFQ sources
 * excluded, built for the Pot 0x344E3e157AD23727a6ec989d656F763500c13838 (anvil's first account's
 * at salt zero) with a 50 bps tolerance and deadline 1791064726. eco-swap has no embeddable
 * endpoint yet; its answers here are the contract the SDK defines (`EcoEmbed`).
 *
 * What the routes DO on chain is `swap.e2e.test.ts`'s.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { bytesToHex, decodeFunctionData, getAddress, type Hex } from "viem";

import { v12DeployedAddresses } from "../src/deployments/index.js";
import { KyberSwapMetaAggregationRouterABI } from "../src/protocols/kyberswap/abis.js";
import { SwapApiError, fetchSwapRoutes } from "../src/routes/swap-apis.js";
import type { SwapApis } from "../src/routes/swap-apis.js";
import {
  kyberFloorOffset,
  swapRouteError,
  type KyberRoute,
  type SwapRequest,
} from "../src/routes/swap-host.js";
import { compileSauceProgram, compileSauceProgramAsync } from "../src/routes/sauce-route.js";
import { requireChain } from "../src/chains/canonical.js";

const FIXTURES = join(process.cwd(), "test", "fixtures", "swap");
const fixture = (name: string): Record<string, unknown> =>
  JSON.parse(readFileSync(join(FIXTURES, name), "utf8")) as Record<string, unknown>;

const POT = "0x344E3e157AD23727a6ec989d656F763500c13838" as Hex;
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as Hex;
const WETH = "0x4200000000000000000000000000000000000006" as Hex;
const ROUTER = "0x6131B5fae19EA4f9D964eAc0408E4408b66337b5" as Hex;
const KYBER = "https://kyber.test";
const ECO = "https://eco.test";
/** When the fixture was built: its deadline is 1200 seconds past. */
const BUILT_AT = 1791063526n;

/** A program that swaps through KyberSwap, and through eco-swap when that reverts. */
const FALLBACK = `function main(recipient: Address, minOut: Uint256) {
  let filled = true;
  try {
    const out = kyberSwap(USDC, WETH, 1000000000, minOut);
    WETH.transfer(recipient, out);
  } catch {
    filled = false;
  }
  if (!filled) {
    const out = ecoSwap(USDC, WETH, 1000000000, minOut);
    WETH.transfer(recipient, out);
  }
}`;

/** eco-swap's answer under the SDK's contract, for USDC to WETH on Base. */
const ecoEmbed = (overrides: Record<string, unknown> = {}) => ({
  embed: {
    version: 1,
    compiler: v12DeployedAddresses().compiler,
    chainId: 8453,
    tokenIn: USDC,
    tokenOut: WETH,
    program: `0x${"5a".repeat(48)}`,
    entryParams: [
      { name: "amountIn", type: "uint256" },
      { name: "minOut", type: "uint256" },
    ],
    amountOut: "372000000000000000",
    ...overrides,
  },
});

interface Asked {
  readonly url: string;
  readonly method: string;
  readonly headers: Record<string, string>;
  readonly body?: Record<string, unknown>;
}

/** A `fetch` answering each provider's request from `answers`, recording what it was asked. */
function serve(
  answers: {
    routes?: unknown;
    build?: unknown;
    eco?: unknown;
    status?: number;
  } = {},
): { fetch: typeof fetch; asked: Asked[] } {
  const asked: Asked[] = [];
  const fetchFake = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    asked.push({
      url,
      method: init?.method ?? "GET",
      headers: { ...(init?.headers as Record<string, string>) },
      ...(typeof init?.body === "string"
        ? { body: JSON.parse(init.body) as Record<string, unknown> }
        : {}),
    });
    const body = url.includes("/api/v1/routes?")
      ? (answers.routes ?? fixture("kyber-base-routes.json"))
      : url.includes("/api/v1/route/build")
        ? (answers.build ?? fixture("kyber-base-build.json"))
        : (answers.eco ?? ecoEmbed());
    return new Response(JSON.stringify(body), { status: answers.status ?? 200 });
  }) as typeof fetch;

  return { fetch: fetchFake, asked };
}

const apis = (fetchFake: typeof fetch): SwapApis => ({
  kyber: { url: KYBER },
  eco: { url: ECO },
  fetch: fetchFake,
  now: () => BUILT_AT,
});

describe("kyberSwap and ecoSwap compile through the host", () => {
  it("the first pass binds placeholders and reports what each call asks for", () => {
    const program = compileSauceProgram("base", FALLBACK, {
      swap: { pot: POT, placeholders: true },
    });
    expect(program.swaps).toEqual([
      {
        request: {
          provider: "kyber",
          chainId: 8453,
          tokenIn: USDC,
          tokenOut: WETH,
          amountIn: 1000000000n,
          pot: POT,
        },
        path: [],
      },
      {
        request: {
          provider: "eco",
          chainId: 8453,
          tokenIn: USDC,
          tokenOut: WETH,
          amountIn: 1000000000n,
          pot: POT,
        },
        path: [],
      },
    ]);
    // `minOut` is `main`'s: known only as the program runs, so absent from each request.
    expect(program.entryParams.map((param) => param.name)).toEqual(["recipient", "minOut"]);
  });

  it("the second pass binds each route: KyberSwap's calldata and eco-swap's program are in the bytecode", async () => {
    const served = serve();
    const program = await compileSauceProgramAsync("base", FALLBACK, {
      swap: { pot: POT, ...apis(served.fetch) },
    });
    const code = bytesToHex(program.bytecode);
    const build = fixture("kyber-base-build.json") as { data: { data: Hex } };
    // Up to its floor, which the program writes as it runs (`minOut` is `main`'s).
    const floor = kyberFloorOffset(Buffer.from(build.data.data.slice(2), "hex"))!;
    expect(code).toContain(build.data.data.slice(2, 2 + floor * 2));
    expect(code).toContain("5a".repeat(48));
    expect(program.swaps.map((site) => site.route?.provider)).toEqual(["kyber", "eco"]);
    const kyber = program.swaps[0]!.route as KyberRoute;
    expect(kyber.router).toBe(ROUTER);
    expect(kyber.quotedOut).toBe(372459356364968576n);
    expect(kyber.deadline).toBe(BUILT_AT + 1200n);
  });

  it("asks KyberSwap as its API documents, for the Pot, and eco-swap under the SDK's contract", async () => {
    const served = serve();
    await compileSauceProgramAsync("base", FALLBACK, { swap: { pot: POT, ...apis(served.fetch) } });
    const [routes, build] = served.asked.filter((asked) => asked.url.startsWith(KYBER));
    const eco = served.asked.find((asked) => asked.url.startsWith(ECO))!;

    const query = new URL(routes!.url);
    expect(query.pathname).toBe("/base/api/v1/routes");
    expect(Object.fromEntries(query.searchParams)).toEqual({
      tokenIn: USDC,
      tokenOut: WETH,
      amountIn: "1000000000",
      excludeRFQSources: "true",
    });
    expect(routes!.headers).toEqual({ "x-client-id": "sauce" });

    expect(new URL(build!.url).pathname).toBe("/base/api/v1/route/build");
    expect(build!.method).toBe("POST");
    const body = build!.body!;
    expect(body.routeSummary).toEqual(
      (fixture("kyber-base-routes.json") as { data: { routeSummary: unknown } }).data.routeSummary,
    );
    expect(body.sender).toBe(POT);
    expect(body.recipient).toBe(POT);
    // Whatever floor this tolerance gives is replaced by the program's minOut.
    expect(body.slippageTolerance).toBe(50);
    expect(body.ignoreCappedSlippage).toBeUndefined();
    expect(body.deadline).toBe(Number(BUILT_AT + 1200n));

    const asked = new URL(eco.url);
    expect(asked.pathname).toBe("/swap");
    expect(Object.fromEntries(asked.searchParams)).toEqual({
      embed: "1",
      chainId: "8453",
      from: USDC,
      to: WETH,
      amountIn: "1000000000",
      pot: POT,
    });
  });

  it("the router's floor is the program's minOut: written in when known, spliced in when not", async () => {
    const build = fixture("kyber-base-build.json") as { data: { data: Hex } };
    const data = Buffer.from(build.data.data.slice(2), "hex");
    const floor = kyberFloorOffset(data)!;
    // Where the router's ABI puts `desc.minReturnAmount`: the word KyberSwap wrote there.
    const decoded = decodeFunctionData({
      abi: KyberSwapMetaAggregationRouterABI,
      data: build.data.data,
    });
    expect(BigInt(`0x${data.subarray(floor, floor + 32).toString("hex")}`)).toBe(
      decoded.args[0].desc.minReturnAmount,
    );
    const withFloor = (minOut: bigint) =>
      `${build.data.data.slice(2, 2 + floor * 2)}${minOut.toString(16).padStart(64, "0")}` +
      build.data.data.slice(2 + floor * 2 + 64);

    const known = await compileSauceProgramAsync(
      "base",
      "function main(): Uint256 { return kyberSwap(USDC, WETH, 1000000000, 360000000000000000); }",
      { swap: { pot: POT, ...apis(serve().fetch) } },
    );
    expect(bytesToHex(known.bytecode)).toContain(withFloor(360000000000000000n));

    // A run-time minOut: the calldata goes in with a word the program writes as it runs.
    const runtime = await compileSauceProgramAsync(
      "base",
      "function main(minOut: Uint256): Uint256 { return kyberSwap(USDC, WETH, 1000000000, minOut); }",
      { swap: { pot: POT, ...apis(serve().fetch) } },
    );
    expect(bytesToHex(runtime.bytecode)).not.toContain(build.data.data.slice(2));
    expect(bytesToHex(runtime.bytecode)).toContain(build.data.data.slice(2, 2 + floor * 2));
  });

  it("an intent body's swap is built for the destination's shared Pot", () => {
    const source = `function main(owner: Address) {
  Base.Portal.send({ token: USDC, amount: 1010000 })
    .refundee(owner)
    .receive({ token: USDC, amount: 1000000 })
    .fee(0)
    .then(() => {
      const out = kyberSwap(USDC, WETH, 1000000, 1);
      WETH.transfer(owner, out);
    });
}`;
    const program = compileSauceProgram("ethereum", source, {
      swap: { placeholders: true },
    });
    expect(program.swaps).toHaveLength(1);
    const [site] = program.swaps;
    expect(site!.request.chainId).toBe(8453);
    // The Pot the body's cook names (`intent-pot.ts`), which the intent's route calls.
    const cook = program.intents[0]!.intent.route.calls.at(-1)!;
    expect(site!.request.pot).toBe(getAddress(`0x${cook.target.slice(-40)}`));
  });
});

describe("what kyberSwap and ecoSwap refuse", () => {
  const refused = (source: string, pattern: RegExp, swap = { pot: POT, placeholders: true }) =>
    expect(() => compileSauceProgram("base", source, { swap })).toThrow(pattern);

  it("tokens known only as the program runs", () => {
    refused(
      `function main(token: Address, minOut: Uint256): Uint256 {
  return kyberSwap(token, WETH, 1000000, minOut);
}`,
      /tokenIn must be known when the program compiles/,
    );
  });

  it("a KyberSwap amount known only as the program runs, which eco-swap takes", () => {
    const source = (fn: string) => `function main(amount: Uint256): Uint256 {
  return ${fn}(USDC, WETH, amount, 0);
}`;
    refused(source("kyberSwap"), /amountIn must be known when the program compiles/);
    const eco = compileSauceProgram("base", source("ecoSwap"), {
      swap: { pot: POT, placeholders: true },
    });
    expect(eco.swaps[0]!.request.amountIn).toBeUndefined();
  });

  it("a KyberSwap route with no Pot to build it for, which a first pass reports", () => {
    const source = "function main(): Uint256 { return kyberSwap(USDC, WETH, 1000000, 0); }";
    expect(() => compileSauceProgram("base", source, { swap: { routes: [] } })).toThrow(
      /builds its calldata for the Pot the program runs on/,
    );
    const probe = compileSauceProgram("base", source, { swap: { placeholders: true } });
    expect(probe.swaps[0]!.request.pot).toBeUndefined();
  });

  it("a swap with no route, outside the first pass", () => {
    expect(() => compileSauceProgram("base", FALLBACK, { swap: { pot: POT } })).toThrow(
      /has no route: its provider is asked while the program compiles/,
    );
  });

  it("a router other than the registry's, in either answer", async () => {
    const routes = fixture("kyber-base-routes.json") as { data: Record<string, unknown> };
    const elsewhere = "0x1111111111111111111111111111111111111111";
    const served = serve({
      routes: { ...routes, data: { ...routes.data, routerAddress: elsewhere } },
    });
    await expect(
      compileSauceProgramAsync("base", FALLBACK, { swap: { pot: POT, ...apis(served.fetch) } }),
    ).rejects.toThrow(
      /answered router 0x1111.* not the registry's Kyberswap.MetaAggregationRouterV2/,
    );
  });

  it("calldata built for another Pot, or another amount", () => {
    const build = fixture("kyber-base-build.json") as { data: { data: Hex } };
    const chain = requireChain("base");
    const request: SwapRequest = {
      provider: "kyber",
      chainId: 8453,
      tokenIn: USDC,
      tokenOut: WETH,
      amountIn: 1000000000n,
      pot: POT,
    };
    const route: KyberRoute = {
      provider: "kyber",
      request,
      router: ROUTER,
      data: build.data.data,
      quotedOut: 1n,
      deadline: 1n,
    };
    expect(swapRouteError(route, request, chain)).toBeUndefined();
    const elsewhere = { ...request, pot: getAddress(`0x${"22".repeat(20)}`) as Hex };
    expect(swapRouteError({ ...route, request: elsewhere }, elsewhere, chain)).toMatch(
      /it pays 0x344E3e157AD23727a6ec989d656F763500c13838, not the Pot/,
    );
    const more = { ...request, amountIn: 2000000000n };
    expect(swapRouteError({ ...route, request: more }, more, chain)).toMatch(
      /it swaps 1000000000, not 2000000000/,
    );
    // The calldata is the router's `swap`, and pays the Pot.
    const decoded = decodeFunctionData({
      abi: KyberSwapMetaAggregationRouterABI,
      data: build.data.data,
    });
    expect(decoded.functionName).toBe("swap");
    expect(decoded.args[0].desc.dstReceiver).toBe(POT);
  });

  it("an eco-swap program from another compiler, for another pair, or of another signature", async () => {
    const attempt = (eco: unknown) =>
      compileSauceProgramAsync("base", FALLBACK, {
        swap: { pot: POT, ...apis(serve({ eco }).fetch) },
      });
    await expect(attempt(ecoEmbed({ compiler: "2.3.0" }))).rejects.toThrow(
      /compiled its program with compiler 2.3.0/,
    );
    await expect(attempt(ecoEmbed({ tokenOut: USDC }))).rejects.toThrow(/another chain or pair/);
    await expect(
      attempt(ecoEmbed({ entryParams: [{ name: "amountIn", type: "uint256" }] })),
    ).rejects.toThrow(/main\(amountIn: Uint256, minOut: Uint256\)/);
    // eco-swap's `/swap` as it answers today: a cook for the old Pot, no `embed`.
    await expect(attempt({ bytecodes: ["0x00"], cook: {} })).rejects.toThrow(/answered no `embed`/);
  });

  it("a provider with no API, and a provider's refusal", async () => {
    await expect(
      fetchSwapRoutes(
        [{ provider: "eco", chainId: 8453, tokenIn: USDC, tokenOut: WETH, pot: POT }],
        {},
      ),
    ).rejects.toThrow(SwapApiError);
    const refusal = serve({
      routes: { code: 4008, message: "route not found", requestId: "x" },
      status: 400,
    });
    await expect(
      compileSauceProgramAsync("base", FALLBACK, { swap: { pot: POT, ...apis(refusal.fetch) } }),
    ).rejects.toThrow(/KyberSwap refused \(400: route not found\)/);
  });
});
