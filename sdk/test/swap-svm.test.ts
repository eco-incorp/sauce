/**
 * The Solana half of `@sauce/swap`'s services, without the program: Jupiter's Swap API client and
 * eco-swap's Solana contract (`routes/swap-apis.ts`), and what a route must be
 * (`routes/swap-host.ts#svmRouteError`); `swap.test.ts` compiles the programs that call them, and
 * `cli-solana-swap.e2e.test.ts` runs one. No network: every answer is a fixture served by a `fetch`
 * the test passes.
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
import { svmSwapTail, type SwapRequest } from "../src/routes/swap-host.js";
import { compileSauceProgram, compileSauceProgramAsync } from "../src/routes/sauce-route.js";

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
  // Eco-swap's merge program: any program id, as the SDK records none yet.
  const program = "BPFLoaderUpgradeab1e11111111111111111111111";
  // The Pot's account for the output token, which the swap pays into.
  let potWsol = "";
  beforeAll(async () => {
    potWsol = await svmTokenAccount(
      { mint: address(WSOL), tokenProgram: TOKEN_PROGRAM_ID },
      address(POT),
    );
  });
  const embed = (overrides: Record<string, unknown> = {}) => ({
    embed: {
      version: 1,
      kind: "instruction",
      chainId: SOLANA,
      tokenIn: USDC,
      tokenOut: WSOL,
      programId: program,
      accounts: [
        { pubkey: POT, isSigner: true, isWritable: false },
        { pubkey: USDC, isSigner: false, isWritable: false },
        { pubkey: potWsol, isSigner: false, isWritable: true },
        { pubkey: program, isSigner: false, isWritable: false },
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
      programIndex: 3,
      outputIndex: 2,
      outputTokenProgram: TOKEN_PROGRAM_ID,
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
    await expect(
      attempt(embed({ accounts: [{ pubkey: POT, isSigner: true, isWritable: false }] })),
    ).rejects.toThrow(/do not include its program/);
    await expect(
      attempt(
        embed({
          accounts: [
            { pubkey: POT, isSigner: true, isWritable: false },
            { pubkey: program, isSigner: false, isWritable: false },
          ],
        }),
      ),
    ).rejects.toThrow(/output account is not a writable account of the Pot's/);
  });
});

describe("jupiterSwap and ecoSwap, compiled for Solana", () => {
  const options = (fetchFake: typeof fetch) => ({
    swap: { pot: POT, ...apis(fetchFake) },
  });
  const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString("hex");
  const served = fixture<Instructions>("jupiter-solana-swap-instructions.json");
  const routeData = Buffer.from(served.swapInstruction.data, "base64");
  const tail = jupiterRouteData(routeData)!.offsets;

  it("puts Jupiter's instruction in the program with its floor the program's minOut, at no slippage", async () => {
    const program = await compileSauceProgramAsync(
      "solana",
      "function main(): Uint256 { return jupiterSwap(USDC, WSOL, 100000000, 830000000); }",
      options(serve().fetch),
    );
    const bound = Uint8Array.from(routeData);
    new DataView(bound.buffer).setBigUint64(tail.quotedOutAmount, 830000000n, true);
    bound.set([0, 0], tail.slippageBps);

    expect(hex(program.bytecode)).toContain(hex(bound));
    expect(hex(program.bytecode)).not.toContain(hex(routeData));
    expect(program.swaps).toHaveLength(1);
    expect(program.swaps[0]!.request).toMatchObject({
      provider: "jupiter",
      tokenIn: USDC,
      tokenOut: WSOL,
      amountIn: 100000000n,
      minOut: 830000000n,
      pot: POT,
    });
    // The route's accounts are all the program reads past its own: it names none of its own.
    expect(program.manifest?.accounts).toEqual([{ kind: "remaining", from: 0 }]);
  });

  it("splices a floor the program computes into the instruction as it runs", async () => {
    const program = await compileSauceProgramAsync(
      "solana",
      "function main(minOut: Uint256): Uint256 { return jupiterSwap(USDC, WSOL, 100000000, minOut); }",
      options(serve().fetch),
    );

    expect(hex(program.bytecode)).toContain(hex(routeData.subarray(0, tail.quotedOutAmount)));
    expect(program.swaps[0]!.request.minOut).toBeUndefined();
    expect(program.entryParams.map((param) => param.name)).toEqual(["minOut"]);
  });

  it("hands the cook the route's accounts, lookup tables and the Pot's output account", async () => {
    const program = await compileSauceProgramAsync(
      "solana",
      "function main(): Uint256 { return jupiterSwap(USDC, WSOL, 100000000, 830000000); }",
      options(serve().fetch),
    );
    const { accounts, lookupTables, outputs } = svmSwapTail(program.swaps);
    const potWsol = await svmTokenAccount(
      { mint: address(WSOL), tokenProgram: TOKEN_PROGRAM_ID },
      address(POT),
    );

    expect(accounts.map((account) => account.address)).toEqual(
      served.swapInstruction.accounts.map((account) => account.pubkey),
    );
    expect(accounts.map((account) => account.writable)).toEqual(
      served.swapInstruction.accounts.map((account) => account.isWritable),
    );
    expect(lookupTables).toEqual(served.addressLookupTableAddresses);
    expect(outputs).toEqual([
      { account: potWsol, owner: POT, mint: WSOL, tokenProgram: TOKEN_PROGRAM_ID },
    ]);
  });

  it("writes eco-swap's amount and floor where its contract says, or splices them", async () => {
    const program = "BPFLoaderUpgradeab1e11111111111111111111111";
    const potWsol = await svmTokenAccount(
      { mint: address(WSOL), tokenProgram: TOKEN_PROGRAM_ID },
      address(POT),
    );
    const data = Buffer.alloc(24, 0xab);
    const eco = {
      embed: {
        version: 1,
        kind: "instruction",
        chainId: SOLANA,
        tokenIn: USDC,
        tokenOut: WSOL,
        programId: program,
        accounts: [
          { pubkey: POT, isSigner: true, isWritable: false },
          { pubkey: potWsol, isSigner: false, isWritable: true },
          { pubkey: program, isSigner: false, isWritable: false },
        ],
        data: data.toString("base64"),
        offsets: { amountIn: 0, minOut: 16 },
      },
    };
    const known = await compileSauceProgramAsync(
      "solana",
      "function main(): Uint256 { return ecoSwap(USDC, WSOL, 100000000, 830000000); }",
      options(serve({ eco }).fetch),
    );
    const written = Buffer.from(data);
    written.writeBigUInt64LE(100000000n, 0);
    written.writeBigUInt64LE(830000000n, 16);
    expect(hex(known.bytecode)).toContain(written.toString("hex"));

    // An amount the program computes, which only eco-swap takes.
    const computed = await compileSauceProgramAsync(
      "solana",
      "function main(amount: Uint256): Uint256 { return ecoSwap(USDC, WSOL, amount / 2, 830000000); }",
      options(serve({ eco }).fetch),
    );
    expect(computed.swaps[0]!.request.amountIn).toBeUndefined();
    expect(hex(computed.bytecode)).toContain(data.subarray(8, 16).toString("hex"));
  });

  it("refuses a second routed swap, the EVM's provider, and a swap with no Pot", async () => {
    await expect(
      compileSauceProgramAsync(
        "solana",
        `function main(): Uint256 {
  return jupiterSwap(USDC, WSOL, 100000000, 0) + jupiterSwap(USDC, WSOL, 5, 0);
}`,
        options(serve().fetch),
      ),
    ).rejects.toThrow(/a program on Solana makes one routed swap/);
    expect(() =>
      compileSauceProgram(
        "solana",
        "function main(): Uint256 { return kyberSwap(USDC, WSOL, 5, 0); }",
      ),
    ).toThrow(/kyberSwap swaps on EVM chains; on solana, jupiterSwap or ecoSwap/);
    expect(() =>
      compileSauceProgram(
        "base",
        "function main(): Uint256 { return jupiterSwap(USDC, WETH, 5, 0); }",
      ),
    ).toThrow(/jupiterSwap swaps on Solana; on base, kyberSwap or ecoSwap/);
    expect(() =>
      compileSauceProgram(
        "solana",
        "function main(): Uint256 { return ecoSwap(USDC, WSOL, 5, 0); }",
        { swap: { routes: [] } },
      ),
    ).toThrow(/ecoSwap: the route is built for the Pot the program runs on/);
  });
});
