/**
 * `kyberSwap(...)` and `ecoSwap(...)` EXECUTED: each route fetched while the program compiles, from
 * a stub of each provider's API served over HTTP on loopback, then cooked by a Pot of the released
 * gated stack on a local anvil (`gated-engine.ts`). Nothing is forked and nothing leaves the machine.
 *
 *   - KyberSwap's router is `fixtures/MockKyberRouter.sol` at the registry's
 *     `Kyberswap.MetaAggregationRouterV2` address: the real router's `swap` signature, so the stub's
 *     calldata is encoded with the registry's ABI as KyberSwap's is, and the route passes the checks
 *     a real one does. It pulls the input, pays a set amount to the Pot, or refuses.
 *   - eco-swap's program is a `@sauce/router` single-pool swap with the contract's
 *     `main(amountIn, minOut)`, compiled here by the SDK's compiler, over `fixtures/MockV2Pair.sol`
 *     (a Uniswap V2 pair's `getReserves`/`swap` with its constant-product check).
 *
 * It also runs KyberSwap's own aggregator example as ported to Sauce, the copy the skills ship
 * (`skills/sauce-swaps/examples/kyberswap-swap.sauce.ts`) and the manual's
 * (`docs/examples/kyberswap-swap.sauce.ts`), held to be the same file.
 *
 * GATED on `SAUCE_V12_RUNTIME_CREATION_HEX` like every EVM execution suite, and a hard failure
 * without it in CI.
 */
import type { ChildProcess } from "node:child_process";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  bytesToHex,
  concatHex,
  createPublicClient,
  createTestClient,
  createWalletClient,
  encodeAbiParameters,
  encodeFunctionData,
  getAddress,
  hexToBigInt,
  http,
  parseAbi,
} from "viem";
import type { Abi, Address, Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { encodeEntryArguments, type EntryValue } from "../../src/routes/entry.js";
import {
  compileSauceProgram,
  compileSauceProgramAsync,
  type CompiledSauceProgram,
} from "../../src/routes/sauce-route.js";
import { freePortSync, spawnAnvil } from "../anvil-process.js";
import { answerSwapApi } from "../swap-stub.js";
import { startGatedEngine } from "./gated-engine.js";
import type { GatedEngine } from "./gated-engine.js";

const RUNTIME_HEX_PATH =
  process.env.SAUCE_V12_RUNTIME_CREATION_HEX ?? process.env.SAUCE_RUST_V12_RUNTIME;
const describeEvm = RUNTIME_HEX_PATH ? describe : describe.skip;
if (!RUNTIME_HEX_PATH && process.env.CI) {
  throw new Error(
    "SAUCE_V12_RUNTIME_CREATION_HEX is unset in CI. This suite must never skip there — see the " +
      '"Fetch the v12 engines" step in .github/workflows/ci.yml.',
  );
}

const HERE = dirname(fileURLToPath(import.meta.url));
const json = <T>(path: string): T => JSON.parse(readFileSync(path, "utf8")) as T;
const MOCK_ERC20 = json<{ creationCode: Hex }>(join(HERE, "../std/token/fixtures/MockERC20.json"));
const MOCK_ROUTER = json<{ abi: Abi; creationCode: Hex }>(
  join(HERE, "fixtures/MockKyberRouter.json"),
);
const MOCK_PAIR = json<{ abi: Abi; creationCode: Hex }>(join(HERE, "fixtures/MockV2Pair.json"));
/** KyberSwap's aggregator example ported to Sauce, as the skills and the manual ship it. */
const KYBERSWAP_PORTS = [
  "skills/sauce-swaps/examples/kyberswap-swap.sauce.ts",
  "docs/examples/kyberswap-swap.sauce.ts",
];
const port = (path: string): string => readFileSync(join(HERE, "../../..", path), "utf8");

/** Anvil's first dev account: the harness's deployer, and the Pot's owner. */
const OWNER = privateKeyToAccount(
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
);
/** Where the swapped WETH goes. */
const RECIPIENT = getAddress("0x70997970c51812dc3a010c7d01b50e0d17dc79c8");
/** The registry's KyberSwap router on Base, where the mock is installed. */
const ROUTER = getAddress("0x6131B5fae19EA4f9D964eAc0408E4408b66337b5");

const PORT = freePortSync();
const RPC_URL = `http://127.0.0.1:${PORT}`;
const GAS_LIMIT = 10_000_000n;

const transport = http(RPC_URL, { fetchOptions: { headers: { connection: "close" } } });
const publicClient = createPublicClient({ transport });
const testClient = createTestClient({ mode: "anvil", transport });
const walletClient = createWalletClient({ account: OWNER, transport });

const erc20 = parseAbi([
  "function mint(address to, uint256 amount)",
  "function balanceOf(address account) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
]);

const AMOUNT = 1_000_000_000n; // 1000 USDC
const KYBER_PAYS = 372_000_000_000_000_000n; // what the router pays for it, 0.372 WETH

/** The program the docs show: KyberSwap, and eco-swap when that reverts. It returns which ran. */
const FALLBACK = `function main(recipient: Address, minOut: Uint256): Uint256 {
  let fellBack = 0;
  try {
    const out = kyberSwap(USDC, WETH, 1000000000, minOut);
    WETH.transfer(recipient, out);
  } catch {
    fellBack = 1;
  }
  if (fellBack == 1) {
    const out = ecoSwap(USDC, WETH, 1000000000, minOut);
    WETH.transfer(recipient, out);
  }
  return fellBack;
}`;

let anvil: ChildProcess;
let api: Server;
let apiUrl: string;
let sauce: GatedEngine;
let usdc: Address;
let weth: Address;
let pair: Address;
/** The program eco-swap's stub serves. */
let ecoProgram: Hex;
/** What the stub was asked, by path. */
const asked: string[] = [];

const send = async (to: Address | null, data: Hex): Promise<{ status: string; at?: Address }> => {
  const hash = await walletClient.sendTransaction({
    account: OWNER,
    chain: null,
    data,
    gas: GAS_LIMIT,
    to,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });

  return { status: receipt.status, at: receipt.contractAddress ?? undefined };
};

const deploy = async (creationCode: Hex): Promise<Address> => {
  const { at } = await send(null, creationCode);
  if (!at) throw new Error("a deployment produced no contract address");

  return at;
};

const balance = (token: Address, holder: Address): Promise<bigint> =>
  publicClient.readContract({
    abi: erc20,
    address: token,
    args: [holder],
    functionName: "balanceOf",
  });

const allowance = (token: Address, owner: Address, spender: Address): Promise<bigint> =>
  publicClient.readContract({
    abi: erc20,
    address: token,
    args: [owner, spender],
    functionName: "allowance",
  });

const mint = (token: Address, to: Address, amount: bigint) =>
  send(token, encodeFunctionData({ abi: erc20, args: [to, amount], functionName: "mint" }));

/** The mock router's behaviour: what it pays, what it takes (zero: all), whether it refuses. */
const router = (pay: bigint, take = 0n, refuse = false) =>
  send(
    ROUTER,
    encodeFunctionData({ abi: MOCK_ROUTER.abi, functionName: "set", args: [pay, take, refuse] }),
  );

/** The `minReturnAmount` the mock router last held. */
const lastFloor = (): Promise<bigint> =>
  publicClient.readContract({
    abi: MOCK_ROUTER.abi,
    address: ROUTER,
    functionName: "lastFloor",
  }) as Promise<bigint>;

/** Compiled for Base with the test's tokens, each swap's route fetched from the stub. */
const compile = (source: string): Promise<CompiledSauceProgram> =>
  compileSauceProgramAsync("base", source, {
    tokens: { USDC: usdc, WETH: weth },
    swap: { pot: sauce.pot, kyber: { url: apiUrl }, eco: { url: apiUrl } },
  });

/** What `main` returns when the Pot cooks `program` with `values`, then the cook, sent. */
const cook = async (
  program: CompiledSauceProgram,
  values: readonly EntryValue[],
): Promise<{ returned: bigint; status: string }> => {
  const payload = concatHex([
    bytesToHex(program.bytecode),
    bytesToHex(encodeEntryArguments(program, values)),
  ]);
  const data = sauce.cookData(payload);
  const { data: returned = "0x" } = await publicClient.call({
    account: OWNER.address,
    to: sauce.pot,
    data,
    gas: GAS_LIMIT,
  });
  const { status } = await send(sauce.pot, data);

  return { returned: returned === "0x" ? 0n : hexToBigInt(returned), status };
};

/** KyberSwap's two calls and eco-swap's embed, answered over HTTP as each API does. */
function stubApi(): Server {
  return createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://stub");
    asked.push(url.pathname);
    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => {
      const { status, json } = answerSwapApi(url, body, {
        kyberQuotes: KYBER_PAYS,
        ecoProgram: () => ecoProgram,
      });
      response.writeHead(status, { "content-type": "application/json" });
      response.end(JSON.stringify(json));
    });
  });
}

/** eco-swap's program: one Uniswap V2 pool, under the embed contract's `main`. */
const ecoSource = (spend: string) => `import { uniswapV2 } from "@sauce/router";

function main(amountIn: Uint256, minOut: Uint256): Uint256 {
  return uniswapV2(${pair}, USDC, WETH, ${spend}, 0, minOut, ctx.self());
}`;

const compileEco = (spend: string): Hex =>
  bytesToHex(
    compileSauceProgram("base", ecoSource(spend), { tokens: { USDC: usdc, WETH: weth } }).bytecode,
  );

/** What the pair pays for `amountIn` at its reserves, as V2 prices it. */
const pairOut = async (amountIn: bigint): Promise<bigint> => {
  const [reserve0, reserve1] = (await publicClient.readContract({
    abi: MOCK_PAIR.abi,
    address: pair,
    functionName: "getReserves",
  })) as readonly [bigint, bigint, number];
  const [reserveIn, reserveOut] =
    BigInt(usdc) < BigInt(weth) ? [reserve0, reserve1] : [reserve1, reserve0];
  const inWithFee = amountIn * 997_000n;

  return (inWithFee * reserveOut) / (reserveIn * 1_000_000n + inWithFee);
};

describeEvm("kyberSwap and ecoSwap, executed on the released gated stack", () => {
  let snapshot: Hex;

  beforeAll(async () => {
    anvil = await spawnAnvil(PORT);
    sauce = await startGatedEngine(
      { publicClient, testClient, walletClient },
      OWNER.address,
      readFileSync(RUNTIME_HEX_PATH as string, "utf8").trim() as Hex,
    );
    usdc = await deploy(MOCK_ERC20.creationCode);
    weth = await deploy(MOCK_ERC20.creationCode);
    // The mock router's code at the registry's address; its storage is its own there.
    const mockRouter = await deploy(MOCK_ROUTER.creationCode);
    await testClient.setCode({
      address: ROUTER,
      bytecode: (await publicClient.getCode({ address: mockRouter }))!,
    });
    await mint(weth, ROUTER, 10n ** 24n);
    pair = await deploy(
      concatHex([
        MOCK_PAIR.creationCode,
        encodeAbiParameters([{ type: "address" }, { type: "address" }], [usdc, weth]),
      ]),
    );
    await mint(usdc, pair, 2_600_000n * 10n ** 6n);
    await mint(weth, pair, 1_000n * 10n ** 18n);
    await send(pair, encodeFunctionData({ abi: MOCK_PAIR.abi, functionName: "sync" }));
    await mint(usdc, sauce.pot, 5n * AMOUNT);
    ecoProgram = compileEco("amountIn");

    api = stubApi();
    await new Promise<void>((resolve) => api.listen(0, "127.0.0.1", resolve));
    apiUrl = `http://127.0.0.1:${(api.address() as AddressInfo).port}`;
  }, 120_000);

  afterAll(async () => {
    await new Promise((resolve) => api?.close(resolve));
    if (anvil && anvil.exitCode === null) {
      const exited = once(anvil, "exit");
      anvil.kill();
      await exited;
    }
  });

  beforeEach(async () => {
    snapshot = await testClient.snapshot();
    asked.length = 0;
  });

  afterEach(async () => {
    await testClient.revert({ id: snapshot });
  });

  it("KyberSwap's route runs: exactly amountIn approved and taken, the output measured in the Pot", async () => {
    await router(KYBER_PAYS);
    const program = await compile(FALLBACK);
    // Each provider asked once, KyberSwap twice: its route, then its calldata.
    expect([...asked].sort()).toEqual(["/base/api/v1/route/build", "/base/api/v1/routes", "/swap"]);
    const held = await balance(usdc, sauce.pot);

    const ran = await cook(program, [RECIPIENT, KYBER_PAYS]);
    expect(ran).toEqual({ returned: 0n, status: "success" });
    expect(await balance(weth, RECIPIENT)).toBe(KYBER_PAYS);
    expect(await balance(usdc, ROUTER)).toBe(AMOUNT);
    expect(await balance(usdc, sauce.pot)).toBe(held - AMOUNT);
    expect(await allowance(usdc, sauce.pot, ROUTER)).toBe(0n);
    // The router held the program's minOut, written into its calldata as the program ran.
    expect(await lastFloor()).toBe(KYBER_PAYS);
  }, 60_000);

  it("a minOut written in the program is the router's floor as it stands", async () => {
    await router(KYBER_PAYS);
    const program = await compile(`function main(): Uint256 {
  return kyberSwap(USDC, WETH, 1000000000, 371000000000000000);
}`);

    expect(await cook(program, [])).toEqual({ returned: KYBER_PAYS, status: "success" });
    expect(await lastFloor()).toBe(371_000_000_000_000_000n);
  }, 60_000);

  it("a router that takes less than it was approved for keeps no allowance", async () => {
    await router(KYBER_PAYS, AMOUNT / 2n);
    const held = await balance(usdc, sauce.pot);

    const ran = await cook(await compile(FALLBACK), [RECIPIENT, 1n]);
    expect(ran).toEqual({ returned: 0n, status: "success" });
    expect(await balance(usdc, sauce.pot)).toBe(held - AMOUNT / 2n);
    expect(await allowance(usdc, sauce.pot, ROUTER)).toBe(0n);
  }, 60_000);

  it("a reverting router: the catch block runs eco-swap's program, and the approval is undone", async () => {
    await router(KYBER_PAYS, 0n, true);
    const expected = await pairOut(AMOUNT);
    const held = await balance(usdc, sauce.pot);

    const ran = await cook(await compile(FALLBACK), [RECIPIENT, 1n]);
    expect(ran).toEqual({ returned: 1n, status: "success" });
    expect(await balance(weth, RECIPIENT)).toBe(expected);
    expect(await balance(usdc, pair)).toBe(2_600_000n * 10n ** 6n + AMOUNT);
    expect(await balance(usdc, ROUTER)).toBe(0n);
    expect(await balance(usdc, sauce.pot)).toBe(held - AMOUNT);
    expect(await allowance(usdc, sauce.pot, ROUTER)).toBe(0n);
  }, 60_000);

  it("KyberSwap below the program's minOut reverts inside the try, and eco-swap fills", async () => {
    // A floor the program computes, spliced into the calldata: the router refuses the short fill.
    await router(KYBER_PAYS - 1n);
    const expected = await pairOut(AMOUNT);

    const ran = await cook(await compile(FALLBACK), [RECIPIENT, KYBER_PAYS]);
    expect(expected).toBeGreaterThanOrEqual(KYBER_PAYS);
    expect(ran).toEqual({ returned: 1n, status: "success" });
    expect(await balance(weth, RECIPIENT)).toBe(expected);
    expect(await balance(usdc, ROUTER)).toBe(0n);
  }, 60_000);

  it("ecoSwap with an amount the program computes, evaluated in the Pot", async () => {
    const program = await compile(`function main(amount: Uint256): Uint256 {
  return ecoSwap(USDC, WETH, amount, 1);
}`);
    expect(program.swaps.map((site) => site.request.amountIn)).toEqual([undefined]);
    const amount = 123_456_789n;
    const expected = await pairOut(amount);
    const before = await balance(weth, sauce.pot);

    const ran = await cook(program, [amount]);
    expect(ran).toEqual({ returned: expected, status: "success" });
    expect(await balance(weth, sauce.pot)).toBe(before + expected);
  }, 60_000);

  it("refuses an eco-swap program that spends more than amountIn", async () => {
    ecoProgram = compileEco("amountIn * 2");
    try {
      const program = await compile(`function main(amount: Uint256): Uint256 {
  return ecoSwap(USDC, WETH, amount, 1);
}`);
      const ran = await cook(program, [1_000_000n]).catch((error: Error) => error);
      // The library's own refusal, as the revert data it reverts with.
      expect(String(ran)).toContain(
        Buffer.from("ecoSwap: spent more than amountIn").toString("hex"),
      );
    } finally {
      ecoProgram = compileEco("amountIn");
    }
  }, 60_000);

  describe("KyberSwap's aggregator example, ported (kyberswap-swap.sauce.ts)", () => {
    it("ships the same program to the skills and the manual", () => {
      const [skill, manual] = KYBERSWAP_PORTS.map(port);
      expect(manual).toBe(skill);
    });

    it.each(KYBERSWAP_PORTS)(
      "runs as written: 1 USDC for WETH, one cook, from %s",
      async (path) => {
        await router(KYBER_PAYS);
        const program = await compile(port(path));
        // The demo's two API calls, asked while the program compiles, for its 1 USDC.
        expect([...asked].sort()).toEqual(["/base/api/v1/route/build", "/base/api/v1/routes"]);
        expect(program.entryParams.map((param) => `${param.name}: ${param.type}`)).toEqual([
          "minOut: Uint256",
          "recipient: Address",
        ]);
        const held = await balance(usdc, sauce.pot);
        const before = await balance(weth, RECIPIENT);

        const ran = await cook(program, [KYBER_PAYS, RECIPIENT]);
        expect(ran).toEqual({ returned: KYBER_PAYS, status: "success" });
        expect(await balance(weth, RECIPIENT)).toBe(before + KYBER_PAYS);
        expect(await balance(usdc, sauce.pot)).toBe(held - 1_000_000n);
        // The demo's standing approval is gone: exactly amountIn approved, the rest reset.
        expect(await allowance(usdc, sauce.pot, ROUTER)).toBe(0n);
        // The router's floor is the program's minOut, where the demo put 0.1% off the quote.
        expect(await lastFloor()).toBe(KYBER_PAYS);
      },
      60_000,
    );

    it("reverts the one transaction below minOut, where the demo's swap would revert alone", async () => {
      await router(KYBER_PAYS);
      const program = await compile(port(KYBERSWAP_PORTS[0]!));
      const held = await balance(usdc, sauce.pot);

      const ran = await cook(program, [KYBER_PAYS + 1n, RECIPIENT]).catch((error: Error) => error);
      expect(ran).toBeInstanceOf(Error);
      expect(await balance(usdc, sauce.pot)).toBe(held);
      expect(await allowance(usdc, sauce.pot, ROUTER)).toBe(0n);
    }, 60_000);
  });
});
