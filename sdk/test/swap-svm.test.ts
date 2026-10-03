/**
 * The Solana half of `@sauce/swap`'s services, without the program: Jupiter's Swap API client and
 * eco-swap's Solana contract (`routes/swap-apis.ts`), and what a route must be
 * (`routes/swap-host.ts#svmRouteError`). The compiler cannot yet hand a route's accounts to a
 * library call (`svm.remainingAccounts()` is `main`'s only), so nothing here compiles a program.
 * No network: every answer is a fixture served by a `fetch` the test passes.
 *
 * `fixtures/swap/jupiter-solana-{quote,swap-instructions}.json` are Jupiter's public Swap API's
 * (`lite-api.jup.ag/swap/v1`) real answers, fetched once by hand on 2026-10-03: 100 USDC
 * (100000000) for SOL (the wrapped-SOL mint), a 50 bps tolerance, built for the Pot
 * B1NfwC9SGiyCTjTedWhHRgyJ4HAeDw1G1dbFBueHL8dZ (the Kitchen's Pot of
 * 4wBqpZM9xaSheZzJSMawUKKwhdpChKbZ5eu5ky4Vigw at salt zero) with `wrapAndUnwrapSol: false` and
 * `useSharedAccounts: true`. eco-swap's answers are the contract the SDK defines (`EcoSvmEmbed`).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { address } from "@solana/kit";
import { bytesToHex } from "viem";

import { svmTokenAccount } from "../src/svm/token-accounts.js";
import { TOKEN_PROGRAM_ID } from "../src/svm/token-program.js";
import {
  JUPITER_AGGREGATOR_PROGRAM_ID,
  jupiterRouteData,
} from "../src/svm/venues/jupiter-aggregator/index.js";
import {
  ecoSvmRoute,
  fetchSwapRoutes,
  jupiterRoute,
  type SwapApis,
} from "../src/routes/swap-apis.js";
import type { SwapRequest } from "../src/routes/swap-host.js";

const FIXTURES = join(process.cwd(), "test", "fixtures", "swap");
const fixture = <T = Record<string, unknown>>(name: string): T =>
  JSON.parse(readFileSync(join(FIXTURES, name), "utf8")) as T;

const SOLANA = 1399811149;
const POT = "B1NfwC9SGiyCTjTedWhHRgyJ4HAeDw1G1dbFBueHL8dZ";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const WSOL = "So11111111111111111111111111111111111111112";
const JUPITER = "https://jupiter.test";
const ECO = "https://eco.test";

const REQUEST: SwapRequest = {
  provider: "jupiter",
  chainId: SOLANA,
  tokenIn: USDC,
  tokenOut: WSOL,
  amountIn: 100000000n,
  pot: POT,
};

type Instructions = {
  swapInstruction: { programId: string; accounts: Record<string, unknown>[]; data: string };
  addressLookupTableAddresses: string[];
};

interface Asked {
  readonly url: URL;
  readonly method: string;
  readonly body?: Record<string, unknown>;
}

/** A `fetch` answering Jupiter's two calls and eco-swap's embed, recording what it was asked. */
function serve(answers: { instructions?: unknown; eco?: unknown } = {}) {
  const asked: Asked[] = [];
  const fetchFake = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    asked.push({
      url,
      method: init?.method ?? "GET",
      ...(typeof init?.body === "string"
        ? { body: JSON.parse(init.body) as Record<string, unknown> }
        : {}),
    });
    const body = url.pathname.endsWith("/swap/v1/quote")
      ? fixture("jupiter-solana-quote.json")
      : url.pathname.endsWith("/swap/v1/swap-instructions")
        ? (answers.instructions ?? fixture("jupiter-solana-swap-instructions.json"))
        : answers.eco;
    return new Response(JSON.stringify(body));
  }) as typeof fetch;

  return { fetch: fetchFake, asked };
}

const apis = (fetchFake: typeof fetch): SwapApis => ({
  jupiter: { url: JUPITER },
  eco: { url: ECO },
  fetch: fetchFake,
});

/** The fixture's swap instruction with `change` applied. */
function tampered(change: (instruction: Instructions["swapInstruction"]) => void): Instructions {
  const answer = fixture<Instructions>("jupiter-solana-swap-instructions.json");
  change(answer.swapInstruction);
  return answer;
}

describe("Jupiter's aggregator instruction, read", () => {
  it("is a shared-accounts route of 100 USDC, its tail at the end of its data", () => {
    const data = Buffer.from(
      fixture<Instructions>("jupiter-solana-swap-instructions.json").swapInstruction.data,
      "base64",
    );
    const decoded = jupiterRouteData(data)!;
    expect(decoded).toMatchObject({
      instruction: "shared_accounts_route",
      inAmount: 100000000n,
      quotedOutAmount: 834568839n,
      slippageBps: 50,
      platformFeeBps: 0,
      accounts: { authority: 2, source: 3, destination: 6, destinationMint: 8 },
    });
    expect(decoded.offsets.inAmount).toBe(data.length - 19);
  });

  it("is nothing for an instruction it does not know", () => {
    expect(jupiterRouteData(Uint8Array.from([1, 2, 3]))).toBeUndefined();
    expect(jupiterRouteData(new Uint8Array(64))).toBeUndefined();
  });
});

describe("jupiterRoute", () => {
  it("asks Jupiter as its API documents, for the Pot, and keeps the swap instruction", async () => {
    const served = serve();
    const route = await jupiterRoute(REQUEST, apis(served.fetch));
    const [quote, build] = served.asked;

    expect(quote!.url.pathname).toBe("/swap/v1/quote");
    expect(Object.fromEntries(quote!.url.searchParams)).toEqual({
      inputMint: USDC,
      outputMint: WSOL,
      amount: "100000000",
      slippageBps: "50",
      swapMode: "ExactIn",
    });
    expect(build!.url.pathname).toBe("/swap/v1/swap-instructions");
    expect(build!.method).toBe("POST");
    expect(build!.body).toEqual({
      quoteResponse: fixture("jupiter-solana-quote.json"),
      userPublicKey: POT,
      wrapAndUnwrapSol: false,
    });

    expect(route.programId).toBe(JUPITER_AGGREGATOR_PROGRAM_ID);
    expect(route.accounts).toHaveLength(29);
    expect(route.accounts.filter((account) => account.isSigner)).toEqual([
      { pubkey: POT, isSigner: true, isWritable: false },
    ]);
    expect(route.lookupTables).toEqual(["2Lvj7QkiAWMHziSQbP4yZcoYJPLTESKUWdscnpbj7Ham"]);
    expect(route.quotedOut).toBe(834568839n);
    // Its token accounts are the Pot's associated accounts.
    expect(route.accounts[3]!.pubkey).toBe(
      await svmTokenAccount({ mint: address(USDC), tokenProgram: TOKEN_PROGRAM_ID }, address(POT)),
    );
    expect(route.accounts[6]!.pubkey).toBe(
      await svmTokenAccount({ mint: address(WSOL), tokenProgram: TOKEN_PROGRAM_ID }, address(POT)),
    );
    expect(route.data).toBe(
      bytesToHex(
        Buffer.from(
          fixture<Instructions>("jupiter-solana-swap-instructions.json").swapInstruction.data,
          "base64",
        ),
      ),
    );
  });

  it.each([
    [
      "another program",
      (i: Instructions["swapInstruction"]) => (i.programId = POT),
      /is not Jupiter's aggregator/,
    ],
    [
      "a second signer",
      (i: Instructions["swapInstruction"]) => (i.accounts[0]!.isSigner = true),
      /not the Pot B1Nfw.* alone/,
    ],
    [
      "an account of another owner paying",
      (i: Instructions["swapInstruction"]) =>
        (i.accounts[3]!.pubkey = "11111111111111111111111111111111"),
      /pays from 11111111111111111111111111111111, not the Pot's account/,
    ],
    [
      "another output token",
      (i: Instructions["swapInstruction"]) => (i.accounts[8]!.pubkey = USDC),
      /it swaps into EPjFW.*, not So111/,
    ],
    [
      "an instruction that is no route",
      (i: Instructions["swapInstruction"]) => (i.data = Buffer.from([1, 2, 3]).toString("base64")),
      /not the aggregator's `route` or `shared_accounts_route`/,
    ],
    [
      "a platform fee",
      (i: Instructions["swapInstruction"]) => {
        const data = Buffer.from(i.data, "base64");
        data[data.length - 1] = 10;
        i.data = data.toString("base64");
      },
      /it pays a platform fee/,
    ],
  ])("refuses %s", async (_name, change, pattern) => {
    const served = serve({ instructions: tampered(change) });
    await expect(jupiterRoute(REQUEST, apis(served.fetch))).rejects.toThrow(pattern);
  });

  it("refuses a route of another amount than the program swaps", async () => {
    const served = serve();
    await expect(jupiterRoute({ ...REQUEST, amountIn: 5n }, apis(served.fetch))).rejects.toThrow(
      /it swaps 100000000, not 5/,
    );
  });

  it("refuses an EVM chain and a missing API", async () => {
    await expect(jupiterRoute({ ...REQUEST, chainId: 8453 }, apis(serve().fetch))).rejects.toThrow(
      /jupiterSwap swaps on Solana/,
    );
    await expect(jupiterRoute(REQUEST, {})).rejects.toThrow(/needs Jupiter's API/);
  });
});

describe("ecoSwap on Solana: one instruction into eco-swap's merge program", () => {
  const embed = (overrides: Record<string, unknown> = {}) => ({
    embed: {
      version: 1,
      kind: "instruction",
      chainId: SOLANA,
      tokenIn: USDC,
      tokenOut: WSOL,
      // Any program id: eco-swap's merge program has none the SDK records yet.
      programId: "BPFLoaderUpgradeab1e11111111111111111111111",
      accounts: [
        { pubkey: POT, isSigner: true, isWritable: false },
        { pubkey: USDC, isSigner: false, isWritable: false },
      ],
      data: Buffer.alloc(24).toString("base64"),
      offsets: { amountIn: 8, minOut: 16 },
      lookupTables: ["2Lvj7QkiAWMHziSQbP4yZcoYJPLTESKUWdscnpbj7Ham"],
      amountOut: "834000000",
      ...overrides,
    },
  });
  const request: SwapRequest = { ...REQUEST, provider: "eco" };

  it("asks for the embed under the SDK's contract, and keeps where the amount and floor sit", async () => {
    const served = serve({ eco: embed() });
    const [route] = await fetchSwapRoutes([request], apis(served.fetch));
    const asked = served.asked[0]!.url;

    expect(asked.pathname).toBe("/swap");
    expect(Object.fromEntries(asked.searchParams)).toEqual({
      embed: "1",
      chainId: String(SOLANA),
      from: USDC,
      to: WSOL,
      amountIn: "100000000",
      pot: POT,
    });
    expect(route).toMatchObject({
      provider: "eco",
      offsets: { amountIn: 8, minOut: 16 },
      quotedOut: 834000000n,
      lookupTables: ["2Lvj7QkiAWMHziSQbP4yZcoYJPLTESKUWdscnpbj7Ham"],
    });
  });

  it("refuses eco-swap's current answer, a second signer, and offsets past the data", async () => {
    const attempt = (eco: unknown) => ecoSvmRoute(request, apis(serve({ eco }).fetch));
    // `/swap` as it answers today on Solana: a staged program and its execution plan.
    await expect(
      attempt({ schema: "sauce-svm-swap/2", program: {}, execution: {}, packet: {} }),
    ).rejects.toThrow(/no `embed` of kind `instruction`/);
    await expect(
      attempt(
        embed({
          accounts: [
            { pubkey: POT, isSigner: true, isWritable: false },
            { pubkey: USDC, isSigner: true, isWritable: true },
          ],
        }),
      ),
    ).rejects.toThrow(/not the Pot .* alone/);
    await expect(attempt(embed({ offsets: { amountIn: 8, minOut: 20 } }))).rejects.toThrow(
      /offsets are not inside its data/,
    );
    await expect(attempt(embed({ tokenOut: USDC }))).rejects.toThrow(/another chain or pair/);
  });
});
