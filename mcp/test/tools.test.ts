/**
 * Every tool, in process over an in-memory transport, with no endpoint configured — so nothing
 * here reaches a network — and each held to what the `sauce` command computes for the same input:
 * the tools are the command's functions, and a tool that drifted from its command would show here.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { after, before, describe, it } from "node:test";

import { decodeFunctionData, getAddress, type Hex } from "viem";

import {
  v12EngineAddress,
  v12KitchenAddress,
  v12SvmKitchenProgramId,
} from "../../sdk/dist/deployments/index.js";
import { potSalt, v12PredictPot } from "../../sdk/dist/deployments/pot.js";
import { v12PotAbi } from "../../sdk/dist/evm/engine.js";
import {
  SETTLE_REJECTIONS,
  SETTLE_VECTORS,
  SETTLE_WIRE,
  settlePayload,
} from "../../sdk/dist/verify/index.js";
import { INTENT_TOOL_NAMES } from "../src/intents.js";
import { SEND_TOOL_NAMES } from "../src/send.js";
import { SKILL_TOOL_NAMES } from "../src/skilltools.js";
import { nodeIo, runCli } from "../../sdk/dist/cli/run.js";
import { FLAG_INPUTS, flagInputLines, LISTED_FLAG_INPUTS } from "../src/terms.js";
import { simulateSummary, TOOL_NAMES } from "../src/tools.js";
import { solanaRpcStub } from "../../sdk/scripts/solana-rpc-stub.mjs";
import { connect, failed, ok, type Connected } from "./harness.js";

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

const OWNER = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const RECIPIENT = "0x6666666666666666666666666666666666666666";
const CREATOR = "0x3333333333333333333333333333333333333333";
const SOLANA_OWNER = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";
const MINT = `0x${"11".repeat(32)}`;

const PAY = [
  "function main(recipient: Address, amount: Uint256) {",
  "  USDC.transfer(recipient, amount);",
  "}",
  "",
].join("\n");

const SVM_PAY = [
  "function main(",
  "  tokenProgram: Account,",
  "  source: Account<Writable>,",
  "  destination: Account<Writable>,",
  "  authority: Account<Signer>,",
  "  amount: Uint256",
  ") {",
  "  transfer(MINT, tokenProgram, source, destination, authority, amount);",
  "}",
  "",
].join("\n");

const INTENT = [
  "// @chain ethereum",
  "function main(recipient: Address) {",
  "  Base(() => {",
  "    USDC.transfer(recipient, 5n);",
  "  }).reward({ tokens: [{ token: USDC, amount: 7n }] });",
  "}",
  "",
].join("\n");

let mcp: Connected;
before(async () => {
  mcp = await connect();
});
after(async () => {
  await mcp.close();
});

describe("the tool list", () => {
  it("is every tool, each with an input and an output schema, read-only but for sending", async () => {
    const { tools } = await mcp.client.listTools();
    assert.deepEqual(
      tools.map((tool) => tool.name),
      [...TOOL_NAMES, ...INTENT_TOOL_NAMES, ...SEND_TOOL_NAMES, ...SKILL_TOOL_NAMES],
    );
    for (const tool of tools) {
      assert.equal(tool.inputSchema.type, "object", `${tool.name} takes an object`);
      assert.equal(tool.outputSchema?.type, "object", `${tool.name} declares its output`);
      assert.ok((tool.description ?? "").length > 80, `${tool.name} says what it does`);
      // The one tool that writes to a chain broadcasts what its caller signed.
      const sends = (SEND_TOOL_NAMES as readonly string[]).includes(tool.name);
      assert.equal(tool.annotations?.readOnlyHint, !sends, `${tool.name} is read-only`);
      assert.equal(tool.annotations?.destructiveHint, sends);
      // No tool takes a key, under any name.
      const fields = Object.keys(tool.inputSchema.properties ?? {});
      for (const field of fields) {
        assert.doesNotMatch(field, /key|secret|password|mnemonic|seed|keystore|keypair/i);
      }
    }
  });

  it("tells a client what the server is, that it never signs, and where the skills are", () => {
    const instructions = mcp.client.getInstructions() ?? "";
    assert.match(instructions, /NOTHING HERE SIGNS\./);
    assert.match(instructions, /sauce:\/\/skills\/index/);
    assert.match(instructions, /has no endpoint of its own/);
    assert.match(instructions, /rpcUrl/);
    // How an agent gets the command the skills write as `sauce …`.
    assert.match(instructions, /`npm i -g @eco-incorp\/sauce` installs it/);
    assert.match(instructions, /`npx -y @eco-incorp\/sauce <command>` runs it with no install/);
    assert.doesNotMatch(instructions, /npx sauce/);
  });
});

describe("the sauce command's flags as the tools' inputs", () => {
  /** Every `sauce` command's --help, together: the flags the command takes. */
  async function commandHelp(): Promise<string> {
    const commands = [
      ["compile"],
      ["actions"],
      ["simulate"],
      ["run"],
      ["tx"],
      ["send"],
      ["reclaim"],
      ["pot"],
      ["globals"],
      ["price"],
      ["pools"],
      ["inspect"],
      ["verify"],
      ...["publish", "fill", "status", "import", "prove", "claim", "refund", "cancel"].map(
        (verb) => ["intent", verb],
      ),
    ];
    let help = "";
    for (const command of commands) {
      const io = { ...nodeIo(), stdout: (text: string) => void (help += text), stderr: () => {} };
      await runCli([...command, "--help"], io);
    }

    return help;
  }

  it("maps each flag to an input a tool takes, and each flag is one the command takes", async () => {
    const { tools } = await mcp.client.listTools();
    const inputs = new Set(tools.flatMap((tool) => Object.keys(tool.inputSchema.properties ?? {})));
    const help = await commandHelp();
    for (const { flags, input } of FLAG_INPUTS) {
      // `prove: false` is the input prove.
      assert.ok(inputs.has(input.split(":")[0]!), `no tool takes ${input}`);
      for (const flag of flags) {
        assert.match(help, new RegExp(`--${flag}\\b`), `no sauce command takes --${flag}`);
      }
    }
  });

  it("says it in the server's instructions and in the MCP guide, one table", () => {
    const instructions = mcp.client.getInstructions() ?? "";
    for (const line of flagInputLines()) assert.ok(instructions.includes(line), line);
    assert.match(instructions, /`sauce <command>` is the tool sauce_<command>/);
    const guide = readFileSync(new URL("../../docs/guides/mcp.md", import.meta.url), "utf8");
    const section = guide.slice(guide.indexOf("### The command's flags as inputs"));
    const rows = [...section.matchAll(/^\| (`--[^|]+?) +\| `([^`]+)` +\|$/gm)].map(
      ([, flags, input]) => ({
        flags: flags!.split(", ").map((flag) => flag.replace(/^`--|`$/g, "")),
        input,
      }),
    );
    assert.deepEqual(rows, LISTED_FLAG_INPUTS);
  });
});

describe("sauce_chains", () => {
  it("lists every chain, and none with an endpoint on a server without a config", async () => {
    const { chains } = ok(await mcp.call("sauce_chains")) as {
      chains: Array<{ slug: string; id: number; kind: string; endpoint: string }>;
    };
    assert.ok(chains.some((chain) => chain.slug === "base" && chain.id === 8453));
    assert.ok(chains.some((chain) => chain.kind === "svm"));
    assert.ok(chains.every((chain) => chain.endpoint === "none"));
  });
});

describe("sauce_globals", () => {
  it("lists a chain's tokens, and one namespace with its methods", async () => {
    const tokens = ok(await mcp.call("sauce_globals", { chain: "base", tokens: true })) as {
      tokens: Array<{ symbol: string; address: string }>;
    };
    assert.ok(tokens.tokens.some((token) => token.symbol === "USDC"));
    const one = ok(await mcp.call("sauce_globals", { chain: 8453, protocol: "UniswapV3" }));
    assert.equal((one.protocol as { namespace: string }).namespace, "UniswapV3");
  });

  it("lists every namespace's contracts without their methods, which `protocol` gives", async () => {
    type Namespace = { namespace: string; contracts: Array<Record<string, unknown>> };
    const all = ok(await mcp.call("sauce_globals", { chain: "base", protocols: true })) as {
      protocols: Namespace[];
    };
    const contracts = all.protocols.flatMap((each) => each.contracts);
    assert.ok(contracts.length > 10);
    assert.ok(contracts.every((contract) => !("methods" in contract)));
    assert.ok(contracts.every((contract) => typeof contract.address === "string"));
    const one = ok(await mcp.call("sauce_globals", { chain: "base", protocol: "UniswapV3" })) as {
      protocol: Namespace;
    };
    assert.ok(one.protocol.contracts.some((contract) => Array.isArray(contract.methods)));
  });

  it("counts tokenized stocks out of the default, and says how to list and find them", async () => {
    const { tools } = await mcp.client.listTools();
    const description = tools.find((tool) => tool.name === "sauce_globals")!.description ?? "";
    assert.match(description, /tokenized stocks/);
    assert.match(description, /`search` finds one by symbol, company name or ticker/);
    const base = ok(await mcp.call("sauce_globals", { chain: "base", tokens: true })) as {
      tokens: Array<{ symbol: string }>;
      page?: unknown;
    };
    assert.deepEqual(
      base.tokens.map((token) => token.symbol),
      ["USDC", "WETH"],
    );
    assert.equal(base.page, undefined);
  });

  it("finds a stock by the company's name, with its issuer, ticker and source", async () => {
    const found = ok(await mcp.call("sauce_globals", { chain: "base", search: "spacex" })) as {
      tokens: Array<{ symbol: string; decimals: number; stock?: Record<string, string> }>;
    };
    assert.deepEqual(found.tokens, [
      {
        symbol: "SPCXc",
        address: "0xb2000000000000000000007b9fcbd005511aCBd5",
        decimals: 8,
        stock: {
          issuer: "coinbase",
          name: "Space Exploration Technologies Corp.",
          ticker: "SPCX",
          issuerName: "Coinbase",
          source: "https://api.coinbase.com/v1/tokenized-stocks",
        },
      },
    ]);
  });

  it("pages a chain's stock tokens", async () => {
    type Page = {
      tokens: Array<{ symbol: string }>;
      page: { offset: number; total: number; next?: number };
    };
    const first = ok(await mcp.call("sauce_globals", { chain: "ethereum", stocks: true })) as Page;
    assert.equal(first.tokens.length, 200);
    assert.ok(first.page.total > 1000);
    assert.equal(first.page.next, 200);
    const last = ok(
      await mcp.call("sauce_globals", {
        chain: "ethereum",
        stocks: true,
        offset: first.page.total - 5,
      }),
    ) as Page;
    assert.equal(last.tokens.length, 5);
    assert.equal(last.page.next, undefined);
    const symbols = new Set(first.tokens.map((token) => token.symbol));
    assert.ok(!symbols.has("USDC"), "the stocks alone");
  });

  it("lists Solana's venue namespaces, and compiles a swap at one with its accounts derived", async () => {
    const listed = ok(await mcp.call("sauce_globals", { chain: "solana", protocols: true })) as {
      venues: Array<{ namespace: string; program: string; methods: string[] }>;
    };
    assert.deepEqual(
      listed.venues.map((venue) => venue.namespace),
      [
        "Raydium.CLMM",
        "Pancakeswap.CLMM",
        "Byreal.CLMM",
        "Stabble.CLMM",
        "Orca.Whirlpool",
        "Cropper.Whirlpool",
        "Defituna.Fusion",
        "Crema.CLMM",
        "Phoenix.Market",
      ],
    );
    assert.equal(
      listed.venues.find((venue) => venue.namespace === "Orca.Whirlpool")!.program,
      "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc",
    );
    const compiled = ok(
      await mcp.call("sauce_compile", {
        source:
          "function main(pool: Address, amountIn: Uint256): Uint256 {\n" +
          "  return Orca.Whirlpool.swap(pool, USDC, WSOL, amountIn, 1, 1);\n}\n",
        chain: "solana",
      }),
    );
    const manifest = compiled.manifest as { accounts: Array<{ name: string; derive?: string }> };
    assert.equal(
      manifest.accounts.find((slot) => slot.name === "poolVaultA")?.derive,
      "slot:@pool:USDC.vaultA",
    );
  });

  it("lists the accounts a program on Solana writes where it uses them, and compiles one", async () => {
    const { tools } = await mcp.client.listTools();
    const description = tools.find((tool) => tool.name === "sauce_globals")!.description ?? "";
    assert.match(description, /`accounts`: Solana\.pda\(program, \[seeds\]\)/);
    const listed = ok(await mcp.call("sauce_globals", { chain: "solana" })) as {
      accounts: Array<{ expression: string; account: string; derive: string }>;
    };
    assert.deepEqual(
      listed.accounts.find((one) => one.expression === "Solana.pda(program, [seeds])"),
      {
        expression: "Solana.pda(program, [seeds])",
        account: "the address program derives for the seeds",
        derive: "pda:<program>:<seeds>",
      },
    );
    assert.equal(
      (ok(await mcp.call("sauce_globals", { chain: "base" })) as { accounts?: unknown }).accounts,
      undefined,
    );
    const compiled = ok(
      await mcp.call("sauce_compile", {
        source:
          "function main(program: Address, owner: Address): Uint256 {\n" +
          '  return Solana.pda(program, ["state", owner]).writable().dataLen;\n}\n',
        chain: "solana",
      }),
    );
    const manifest = compiled.manifest as {
      accounts: Array<{ name: string; requires: string; derive?: string }>;
    };
    assert.deepEqual(
      manifest.accounts.map(({ name, requires, derive }) => ({ name, requires, derive })),
      [{ name: "statePda", requires: "writable", derive: 'pda:@program:"state",@owner' }],
    );
  });

  it("lists, finds and pages Solana's stock mints, each a Token-2022 mint with its issuer", async () => {
    const { tools } = await mcp.client.listTools();
    const description = tools.find((tool) => tool.name === "sauce_globals")!.description ?? "";
    assert.match(description, /Solana's are Token-2022 mints/);
    const solana = ok(await mcp.call("sauce_globals", { chain: "solana", tokens: true })) as {
      tokens: Array<{ symbol: string }>;
    };
    assert.deepEqual(
      solana.tokens.map((token) => token.symbol),
      ["PYUSD", "USDC", "USDT", "WSOL"],
    );
    const found = ok(await mcp.call("sauce_globals", { chain: "solana", search: "NVDA_US" })) as {
      tokens: Array<Record<string, unknown>>;
    };
    assert.deepEqual(found.tokens, [
      {
        symbol: "NVDA_US",
        address: "0x05811804c522f00623562e27a21b33757ca5dd2902cd2225f6411b393b04bb65",
        decimals: 6,
        mint: "NVDAVuiB7hwd3m5Wa1JuHNovPaPG6BH1QNztbKFxNjv",
        tokenProgram: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
        stock: {
          issuer: "backpack",
          name: "NVIDIA Corporation",
          ticker: "NVDA",
          issuerName: "Backpack Securities",
          source: "https://api.backpack.exchange/api/v1/assets",
        },
      },
    ]);
    const page = ok(
      await mcp.call("sauce_globals", { chain: "solana", stocks: true, offset: 200 }),
    ) as { tokens: Array<{ symbol: string }>; page: { offset: number; total: number } };
    assert.equal(page.tokens.length, 200);
    assert.ok(page.page.total > 1000);
    assert.deepEqual(page.page.offset, 200);
  });

  it("names an unknown chain or namespace as the error", async () => {
    assert.match(failed(await mcp.call("sauce_globals", { chain: "nowhere" })), /nowhere/);
    assert.match(
      failed(await mcp.call("sauce_globals", { chain: "base", protocol: "NoSuchThing" })),
      /NoSuchThing/,
    );
  });
});

describe("sauce_price", () => {
  it("turns a price into the pool's sqrtPriceX96 and both directions' limits, and back", async () => {
    type Side = { maxPrice: string; maxAvgPrice: string; minAvgPrice: string };
    const out = ok(
      await mcp.call("sauce_price", { chain: "base", base: "WETH", quote: "USDC", price: "2700" }),
    ) as { sqrtPriceX96: string; sell: Side; buy: Side; units: Record<string, string> };
    assert.match(out.sqrtPriceX96, /^\d+$/);
    // Buying WETH with USDC: the distributed swap's maxPrice and maxAvgPrice, USDC units paid per
    // WETH unit times 1e18 (2700 x 10^(18 + 6 - 18)); minAvgPrice the other way round.
    assert.equal(out.buy.maxPrice, "2700000000");
    assert.equal(out.buy.maxAvgPrice, "2700000000");
    assert.equal(out.buy.minAvgPrice, ((10n ** 36n + 2699999999n) / 2700000000n).toString());
    assert.equal(out.sell.minAvgPrice, "2700000000");
    assert.equal(out.sell.maxPrice, (10n ** 36n / 2700000000n).toString());
    assert.match(out.units.maxAvgPrice!, /distributed swap's maxAvgPrice/);
    assert.match(out.units.minAvgPrice!, /never a maxPrice or maxAvgPrice/);
    const back = ok(
      await mcp.call("sauce_price", {
        chain: "base",
        base: "WETH",
        quote: "USDC",
        sqrtPriceX96: out.sqrtPriceX96,
      }),
    );
    assert.equal(Math.round(Number(back.price)), 2700);
  });

  it("puts each direction's limit slippageBps from the price, its floor paying the fee", async () => {
    type Side = {
      price: string;
      sqrtPriceLimitX96: string;
      maxPrice: string;
      maxAvgPrice: string;
      minAvgPrice: string;
    };
    const pair = { chain: "base", base: "WETH", quote: "USDC" };
    const out = ok(
      await mcp.call("sauce_price", { ...pair, price: "2700", slippageBps: 50, feePpm: 3000 }),
    ) as { limits: { slippageBps: number; feePpm: number; sell: Side; buy: Side } };
    assert.deepEqual([out.limits.slippageBps, out.limits.feePpm], [50, 3000]);
    assert.deepEqual([out.limits.sell.price, out.limits.buy.price].map(Number), [2686.5, 2713.5]);
    // Each limit is the pool's price there; each floor is the price there, net of the fee.
    const at = async (price: string) =>
      ok(await mcp.call("sauce_price", { ...pair, price })) as {
        sell: Side;
        buy: Side;
      };
    assert.equal(out.limits.sell.sqrtPriceLimitX96, (await at("2686.5")).sell.sqrtPriceLimitX96);
    assert.equal(out.limits.buy.sqrtPriceLimitX96, (await at("2713.5")).buy.sqrtPriceLimitX96);
    // 2700 * 0.995 * 0.997.
    assert.equal(out.limits.sell.minAvgPrice, (await at("2678.4405")).sell.minAvgPrice);
    // 2700 * 1.005 / 0.997, to the 24 places the tool computes it to.
    const worst = await at("2721.664994984954864593781344");
    assert.equal(out.limits.buy.minAvgPrice, worst.buy.minAvgPrice);
    // The distributed swap's maxPrice is that same worst price, fee included, as input per output.
    assert.equal(out.limits.buy.maxPrice, worst.buy.maxPrice);
    assert.equal(out.limits.buy.maxAvgPrice, worst.buy.maxPrice);
    assert.equal(out.limits.sell.maxPrice, (await at("2678.4405")).sell.maxPrice);
    const feeless = ok(
      await mcp.call("sauce_price", { ...pair, price: "2700", slippageBps: 50 }),
    ) as { limits: { feePpm: number; sell: Side } };
    assert.equal(feeless.limits.feePpm, 0);
    assert.equal(feeless.limits.sell.minAvgPrice, (await at("2686.5")).sell.minAvgPrice);
  });

  it("reads a pool only through an endpoint, and says so without one", async () => {
    const message = failed(
      await mcp.call("sauce_price", {
        chain: "base",
        base: "WETH",
        quote: "USDC",
        pool: "0xd0b53D9277642d899DF5C87A3966A349A798F224",
      }),
    );
    assert.match(message, /Reading a pool needs an RPC endpoint for base/);
    assert.match(message, /Pass rpcUrl with the call/);
  });

  it("takes one of price and sqrtPriceX96, on an EVM chain", async () => {
    assert.match(
      failed(await mcp.call("sauce_price", { chain: "base", base: "WETH", quote: "USDC" })),
      /give one of price, sqrtPriceX96, or pool/,
    );
    assert.match(
      failed(
        await mcp.call("sauce_price", { chain: "solana", base: "SOL", quote: "USDC", price: "1" }),
      ),
      /solana has none/,
    );
  });

  it("reads an unregistered address's decimals only through an endpoint, and says so", async () => {
    const message = failed(
      await mcp.call("sauce_price", {
        chain: "base",
        base: `0x${"12".repeat(20)}`,
        quote: "USDC",
        price: "1",
      }),
    );
    assert.match(message, /its decimals are not known: give them as 0x[0-9a-fA-F]{40}:<decimals>/);
    assert.match(message, /or an endpoint \(rpcUrl or --config\) to read them from the token/);
  });
});

describe("sauce_pools", () => {
  it("lists a pair's pools only through an endpoint, and says so without one", async () => {
    const message = failed(
      await mcp.call("sauce_pools", { chain: "base", tokenA: "USDC", tokenB: "WETH" }),
    );
    assert.match(message, /Listing a pair's pools needs an RPC endpoint for base/);
    assert.match(message, /Pass rpcUrl with the call/);
  });

  it("returns a Solana listing its output schema takes: no block, mints for addresses, skipped", async () => {
    const stub = await solanaRpcStub();
    try {
      const listed = ok(
        await mcp.call("sauce_pools", {
          chain: "solana",
          tokenA: "USDC",
          tokenB: "SOL",
          limit: 4,
          rpcUrl: stub.url,
        }),
      ) as { tokens: { symbol: string; mint: string }[]; pools: unknown[]; skipped: unknown[] };
      assert.deepEqual(
        listed.tokens.map((token) => token.symbol),
        ["USDC", "WSOL"],
      );
      assert.deepEqual([listed.pools, listed.skipped], [[], []]);
      assert.ok(stub.methods.has("getProgramAccounts"));
      // Chosen for a swap paying USDC: no pool, so every slot's accounts the System program.
      const chosen = ok(
        await mcp.call("sauce_pools", {
          chain: "solana",
          tokenA: "USDC",
          tokenB: "WSOL",
          pay: "USDC",
          perVenue: true,
          rpcUrl: stub.url,
        }),
      ) as { chosen: unknown[]; accounts: Record<string, string> };
      assert.deepEqual(chosen.chosen, []);
      assert.equal(Object.keys(chosen.accounts).length, 36);
      assert.equal(chosen.accounts.ticks32, "11111111111111111111111111111111");
    } finally {
      await stub.close();
    }
  });

  it("lists Solana's pools through an endpoint too, and refuses a V4 key it cannot read before one", async () => {
    assert.match(
      failed(await mcp.call("sauce_pools", { chain: "solana", tokenA: "USDC", tokenB: "SOL" })),
      /Listing a pair's pools needs an RPC endpoint for solana/,
    );
    assert.match(
      failed(
        await mcp.call("sauce_pools", {
          chain: "base",
          tokenA: "USDC",
          tokenB: "WETH",
          v4Pools: ["3000"],
        }),
      ),
      /v4Pools 3000: a hookless V4 pool's key is <fee>:<tickSpacing>/,
    );
    assert.equal(
      (
        await mcp.call("sauce_pools", {
          chain: "base",
          tokenA: "USDC",
          tokenB: "WETH",
          v4Pools: Array.from({ length: 33 }, () => "1:1"),
        })
      ).isError,
      true,
    );
  });
});

describe("sauce_compile", () => {
  it("compiles a program with its own ABI beside it, given in modules", async () => {
    // The sauce-script skill's example: the factory and the pool namespaces, `observe` through
    // the program's own ./IOracle.json.
    const examples = new URL("../../skills/sauce-script/examples/", import.meta.url);
    const source = readFileSync(new URL("twap.sauce.ts", examples), "utf8");
    const abi = readFileSync(new URL("IOracle.json", examples), "utf8");
    const out = ok(
      await mcp.call("sauce_compile", { source, chain: "base", modules: { "IOracle.json": abi } }),
    );
    assert.match(out.bytecode as string, /^0x[0-9a-f]+$/);
    assert.deepEqual(
      (out.entryParams as Array<{ name: string }>).map((param) => param.name),
      ["tokenA", "tokenB", "fee", "window"],
    );
    // Without the module, the import has nothing to resolve to.
    assert.match(
      failed(await mcp.call("sauce_compile", { source, chain: "base" })),
      /IOracle\.json/,
    );
  });

  it("compiles a program file that starts with a #! line as the file without it", async () => {
    const program = "function main(to: Address) {\n  USDC.transfer(to, 1n);\n}\n";
    const plain = ok(await mcp.call("sauce_compile", { source: program, chain: "base" }));
    const shebang = ok(
      await mcp.call("sauce_compile", {
        source: `#!/usr/bin/env -S npx -y @eco-incorp/sauce simulate\n${program}`,
        chain: "base",
      }),
    );
    assert.equal(shebang.bytecode, plain.bytecode);
  });

  it("compiles for the chain: bytecode, size, main's parameters, defines, compiler, engine", async () => {
    const out = ok(
      await mcp.call("sauce_compile", {
        source: "function main() {\n  USDC.transfer(RECIPIENT, AMOUNT);\n}\n",
        chain: "base",
        defines: { RECIPIENT, AMOUNT: "1000000" },
      }),
    );
    assert.equal(out.chain, "base");
    assert.equal(out.chainId, 8453);
    assert.equal(out.target, "evm");
    assert.match(out.bytecode as string, /^0x[0-9a-f]+$/);
    assert.equal(out.size, ((out.bytecode as string).length - 2) / 2);
    assert.deepEqual(out.entryParams, []);
    // Each define the program reads, with where it came from: the call's, or the chain's.
    assert.deepEqual(
      (out.defines as Array<{ name: string; value: string; source: string }>).map(
        ({ name, value, source }) => [name, value, source],
      ),
      [
        ["AMOUNT", "1000000", "user"],
        ["RECIPIENT", RECIPIENT, "user"],
        ["USDC", "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", "chain"],
      ],
    );
    // main takes nothing, so the payload is the program itself.
    assert.deepEqual(out.payload, { size: out.size, argumentsSize: 0 });
    assert.equal((out.engine as { release: string }).release, "v12-evm");
    assert.equal((out.compiler as { name: string }).name, "@eco-incorp/sauce-compiler");
  });

  it("refuses an intent deadline that has passed, as the command does", async () => {
    const refused = failed(
      await mcp.call("sauce_compile", {
        source: INTENT,
        args: [RECIPIENT],
        intentDeadline: 1728432000,
        intentCreator: CREATOR,
      }),
    );
    assert.match(
      refused,
      /1728432000 \(2024-10-09T00:00:00\.000Z\) has passed: an intent can be filled only until its deadline/,
    );
  });

  it("shows a define as an address only where it was written as one", async () => {
    // A price limit just under MAX_SQRT_RATIO is 160 bits wide, and a number all the same.
    const limit = "1461446703485210103287273052203988822378723970341";
    const out = ok(
      await mcp.call("sauce_compile", {
        source:
          "const LIMIT = 0n;\nfunction main() {\n  require(LIMIT > 0n);\n  USDC.transfer(RECIPIENT, 1n);\n}\n",
        chain: "base",
        defines: { LIMIT: limit, RECIPIENT },
      }),
    );
    assert.deepEqual(
      (out.defines as Array<{ name: string; value: string }>).map(({ name, value }) => [
        name,
        value,
      ]),
      [
        ["LIMIT", limit],
        ["RECIPIENT", RECIPIENT],
        ["USDC", "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"],
      ],
    );
  });

  it("sizes the payload main's args make, and refuses accounts off Solana", async () => {
    const out = ok(
      await mcp.call("sauce_compile", { source: PAY, chain: "base", args: [RECIPIENT, "1"] }),
    );
    // Two ABI words appended to the program.
    assert.deepEqual(out.payload, { size: (out.size as number) + 64, argumentsSize: 64 });
    assert.match(
      failed(
        await mcp.call("sauce_compile", {
          source: PAY,
          chain: "base",
          accounts: { mint: "pot" },
        }),
      ),
      /accounts names a Solana program's accounts; a program on base takes none/,
    );
  });

  it("reports main's runtime parameters, and the compact-v1 schema with compactArgs", async () => {
    const abi = ok(await mcp.call("sauce_compile", { source: PAY, chain: "base" }));
    assert.deepEqual(abi.entryParams, [
      { name: "recipient", type: "Address" },
      { name: "amount", type: "Uint256" },
    ]);
    assert.equal(abi.entryEncoding, "abi-v1");
    assert.equal(abi.entrySchema, null);
    const compact = ok(
      await mcp.call("sauce_compile", { source: PAY, chain: "base", compactArgs: true }),
    );
    assert.equal(compact.entryEncoding, "compact-v1");
    assert.match(compact.entrySchema as string, /^0x[0-9a-f]+$/);
  });

  it("returns the account manifest on Solana, and takes the chain from the header", async () => {
    const out = ok(
      await mcp.call("sauce_compile", {
        source: `// @target svm\n${SVM_PAY}`,
        defines: { MINT },
      }),
    );
    assert.equal(out.chain, "solana");
    assert.deepEqual(
      (out.defines as Array<{ name: string; source: string }>).map(({ name, source }) => [
        name,
        source,
      ]),
      [["MINT", "user"]],
    );
    const manifest = out.manifest as { accounts: Array<{ name?: string; kind: string }> };
    assert.deepEqual(
      manifest.accounts.filter((entry) => entry.kind === "slot").map((entry) => entry.name),
      ["tokenProgram", "source", "destination", "authority"],
    );
  });

  it("lists the accounts the token methods add on Solana, each with how the cook derives it", async () => {
    const out = ok(
      await mcp.call("sauce_compile", {
        source: "function main(to: Address, amount: Uint256) {\n  USDC.transfer(to, amount);\n}\n",
        chain: "solana",
        args: [SOLANA_OWNER, "400"],
      }),
    );
    const manifest = out.manifest as {
      accounts: Array<{ name?: string; kind: string; derive?: string }>;
    };
    assert.deepEqual(
      manifest.accounts.map((entry) => [entry.name, entry.derive]),
      [
        ["tokenProgram", "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"],
        ["pot", "self"],
        ["potUSDC", "self:USDC"],
        ["toUSDC", "@to:USDC"],
      ],
    );
    // Sized with every derived account, none assumed: the cook needs no accounts input.
    assert.deepEqual((out.cook as { assumed: string[] }).assumed, []);
  });

  it("takes a Solana key define in base58, as the sauce command does", async () => {
    const base58 = ok(
      await mcp.call("sauce_compile", {
        source: SVM_PAY,
        chain: "solana",
        defines: { MINT: SOLANA_OWNER },
      }),
    );
    assert.match(base58.bytecode as string, /^0x[0-9a-f]+$/);
    assert.match(
      failed(
        await mcp.call("sauce_compile", {
          source: PAY,
          chain: "base",
          defines: { RECIPIENT: SOLANA_OWNER },
        }),
      ),
      /is a Solana public key/,
    );
  });

  it("resolves a relative import from the modules the call carries, and only from those", async () => {
    const source = [
      'import { double } from "./lib/math.sauce.ts";',
      "function main(): Uint256 {",
      "  return double(21n);",
      "}",
      "",
    ].join("\n");
    const modules = {
      "lib/math.sauce.ts": "export function double(x: Uint256): Uint256 {\n  return x * 2n;\n}\n",
    };
    const out = ok(await mcp.call("sauce_compile", { source, chain: "base", modules }));
    assert.match(out.bytecode as string, /^0x[0-9a-f]+$/);
    // The same import with no module given is not read from the server's disk.
    assert.match(failed(await mcp.call("sauce_compile", { source, chain: "base" })), /math/);
    assert.match(
      failed(
        await mcp.call("sauce_compile", { source, chain: "base", modules: { "../x.ts": "" } }),
      ),
      /not a relative path inside the program's tree/,
    );
    // A Windows separator is a separator, and one file given twice is refused.
    const windows = { "lib\\math.sauce.ts": modules["lib/math.sauce.ts"] };
    assert.equal(
      ok(await mcp.call("sauce_compile", { source, chain: "base", modules: windows })).bytecode,
      out.bytecode,
    );
    assert.match(
      failed(
        await mcp.call("sauce_compile", {
          source,
          chain: "base",
          modules: { ...modules, "./lib/math.sauce.ts": "" },
        }),
      ),
      /given twice/,
    );
    assert.match(
      failed(await mcp.call("sauce_compile", { source, chain: "base", file: "a\u0000b.sauce.ts" })),
      /NUL byte/,
    );
  });

  it("fails with the line that does not compile, and says what each CLI flag is here", async () => {
    const message = failed(
      await mcp.call("sauce_compile", {
        source: "function main() {\n  nope(;\n}\n",
        chain: "base",
      }),
    );
    assert.match(message, /program\.sauce\.ts does not compile for base/);
    const chainless = failed(await mcp.call("sauce_compile", { source: PAY }));
    // The command's message, in this tool's words: the input, not the flag.
    assert.match(chainless, /missing chain <slug\|id>/);
    assert.doesNotMatch(chainless, /--chain/);
  });

  it("refuses a define the program would never see, and a malformed one", async () => {
    assert.match(
      failed(
        await mcp.call("sauce_compile", {
          source: "const AMOUNT = 5n;\nrequire(AMOUNT > 0n);\n",
          chain: "base",
          defines: { AMOUNT: 7 },
        }),
      ),
      /would not reach/,
    );
    assert.match(
      failed(
        await mcp.call("sauce_compile", { source: PAY, chain: "base", defines: { X: "abc" } }),
      ),
      /not a define value/,
    );
  });

  it("says its source's sha256, and with omitBytecode leaves the bytecode out", async () => {
    const full = ok(await mcp.call("sauce_compile", { source: PAY, chain: "base" }));
    assert.equal(full.sourceSha256, sha256(PAY));
    const lean = ok(
      await mcp.call("sauce_compile", { source: PAY, chain: "base", omitBytecode: true }),
    );
    assert.equal(lean.bytecode, undefined);
    const { bytecode: _bytecode, ...rest } = full;
    assert.deepEqual(lean, rest);
    assert.ok(JSON.stringify(lean).length < JSON.stringify(full).length);
  });

  it("reads a program by path only over stdio, its imports beside it", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sauce-mcp-path-"));
    try {
      mkdirSync(join(dir, "lib"));
      const program = [
        'import { double } from "./lib/math.sauce.ts";',
        "function main(recipient: Address, amount: Uint256) {",
        "  USDC.transfer(recipient, double(amount));",
        "}",
        "",
      ].join("\n");
      const math = "export function double(x: Uint256): Uint256 {\n  return x * 2n;\n}\n";
      writeFileSync(join(dir, "pay.sauce.ts"), program);
      writeFileSync(join(dir, "lib/math.sauce.ts"), math);
      // Relative to the directory the server runs in, as an agent beside it names it.
      const path = relative(process.cwd(), join(dir, "pay.sauce.ts"));
      const local = await connect(undefined, undefined, undefined, true);
      try {
        const { tools } = await local.client.listTools();
        const compile = tools.find((tool) => tool.name === "sauce_compile")!;
        assert.ok("path" in (compile.inputSchema.properties ?? {}));
        assert.ok(!(compile.inputSchema.required ?? []).includes("source"));
        const byPath = ok(await local.call("sauce_compile", { path, chain: "base" }));
        const bySource = ok(
          await mcp.call("sauce_compile", {
            source: program,
            chain: "base",
            modules: { "lib/math.sauce.ts": math },
          }),
        );
        assert.equal(byPath.bytecode, bySource.bytecode);
        assert.equal(byPath.sourceSha256, sha256(program));
        assert.equal(byPath.sourceSha256, bySource.sourceSha256);
        // The cook from the same file, tied to it the same way.
        const tx = ok(
          await local.call("sauce_tx", {
            path,
            chain: "base",
            owner: OWNER,
            value: 0,
            args: [RECIPIENT, "1"],
          }),
        );
        assert.equal(tx.sourceSha256, sha256(program));
        // A rehearsal reads the file before it needs an endpoint.
        assert.match(
          failed(
            await local.call("sauce_simulate", {
              path: `${path}.missing`,
              chain: "base",
              owner: OWNER,
            }),
          ),
          /path .*\.missing: no such file \(read relative to /,
        );
        assert.match(
          failed(await local.call("sauce_compile", { path, source: program, chain: "base" })),
          /give source or path, not both/,
        );
        assert.match(
          failed(
            await local.call("sauce_compile", { path, chain: "base", modules: { "a.ts": "" } }),
          ),
          /give neither file nor modules/,
        );
        assert.match(
          failed(await local.call("sauce_compile", { chain: "base" })),
          /missing source: the program's text, or path: its file/,
        );
        assert.match(local.client.getInstructions() ?? "", /given by path/);
      } finally {
        await local.close();
      }
      // A server not over stdio reads no file: path is no input of its tools.
      const { tools } = await mcp.client.listTools();
      for (const name of ["sauce_compile", "sauce_simulate", "sauce_tx"]) {
        const tool = tools.find((each) => each.name === name)!;
        assert.ok(!("path" in (tool.inputSchema.properties ?? {})), name);
        assert.ok((tool.inputSchema.required ?? []).includes("source"), name);
      }
      assert.match(failed(await mcp.call("sauce_compile", { path, chain: "base" })), /path/);
      assert.doesNotMatch(mcp.client.getInstructions() ?? "", /given by path/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("bounds its input: an oversized program or an unknown field is refused", async () => {
    const huge = "x".repeat(256 * 1024 + 1);
    assert.equal((await mcp.call("sauce_compile", { source: huge, chain: "base" })).isError, true);
    assert.equal(
      (await mcp.call("sauce_compile", { source: PAY, chain: "base", privateKey: "0x01" })).isError,
      true,
    );
  });
});

describe("sauce_actions", () => {
  /** Names only, no chainId: the same document on every chain that registers them. */
  const DOCUMENT = {
    version: 1,
    actions: [
      { type: "argument", name: "amount" },
      {
        type: "uniswapV3Swap",
        tokenIn: "USDC",
        tokenOut: "WETH",
        factory: "UniswapV3.Factory",
        fee: 500,
        amountOutMin: "1",
        recipient: "self",
      },
    ],
  };
  type Report = {
    bytecode: string;
    chain: string;
    source: string;
    parameters: string[];
    entryParams: unknown[];
    transaction?: unknown;
  };

  it("returns what sauce actions does: the lowered source and its compile", async () => {
    const out = ok(await mcp.call("sauce_actions", { program: DOCUMENT, chain: "base" })) as Report;
    // The command's own function, called directly.
    const { actionsCommand } = await import("../../sdk/dist/cli/actions.js");
    const command = await actionsCommand({
      file: "actions.json",
      text: JSON.stringify(DOCUMENT),
      chain: "base",
    });
    assert.equal(out.source, command.json.source);
    assert.equal(out.bytecode, command.json.bytecode);
    assert.equal(out.chain, "base");
    assert.deepEqual(out.parameters, ["amount"]);
    assert.deepEqual(out.entryParams, [{ name: "a_amount", type: "Uint256" }]);
    assert.equal(out.transaction, undefined, "no Pot given, no transaction");
    // As JSON text, the same program; on another chain, that chain's names.
    const text = ok(
      await mcp.call("sauce_actions", { program: JSON.stringify(DOCUMENT), chain: 8453 }),
    ) as Report;
    assert.equal(text.bytecode, out.bytecode);
    const ethereum = ok(
      await mcp.call("sauce_actions", { program: DOCUMENT, chain: "ethereum" }),
    ) as Report;
    assert.notEqual(ethereum.bytecode, out.bytecode);
  });

  it("builds the unsigned cook for a Pot, with the argument actions as main's arguments", async () => {
    const out = ok(
      await mcp.call("sauce_actions", {
        program: DOCUMENT,
        chain: "base",
        owner: OWNER,
        value: "0",
        args: ["1000"],
      }),
    ) as Report & { transaction: { to: string; data: string; value: string } };
    assert.equal(out.transaction.to, v12PredictPot(OWNER, `0x${"00".repeat(32)}`));
    assert.equal(out.transaction.value, "0");
    const cook = decodeFunctionData({ abi: v12PotAbi, data: out.transaction.data as Hex });
    assert.ok((cook.args[1] as string).startsWith(out.bytecode));
    assert.ok((cook.args[1] as string).endsWith((1000).toString(16).padStart(64, "0")));
  });

  it("names each problem: a missing chain, a name the chain lacks, a field, bad JSON", async () => {
    const chainless = failed(await mcp.call("sauce_actions", { program: DOCUMENT }));
    assert.match(chainless, /missing chain <slug\|id>: actions.json has no chainId/);
    assert.doesNotMatch(chainless, /--chain/);
    assert.match(
      failed(
        await mcp.call("sauce_actions", {
          program: {
            ...DOCUMENT,
            actions: [DOCUMENT.actions[0], { ...DOCUMENT.actions[1], tokenIn: "NOSUCHTOKEN" }],
          },
          chain: "base",
        }),
      ),
      /actions\.json does not compile for base:\n\s+actions\[1\]\.tokenIn/,
    );
    assert.match(
      failed(
        await mcp.call("sauce_actions", {
          program: { version: 1, actions: [{ type: "approve", token: "USDC" }] },
          chain: "base",
        }),
      ),
      /actions\[0\]/,
    );
    assert.match(
      failed(await mcp.call("sauce_actions", { program: "{not json", chain: "base" })),
      /actions\.json is not JSON/,
    );
  });
});

describe("sauce_tx", () => {
  it("builds the unsigned EVM cook on the owner's Pot, with main's arguments", async () => {
    const out = ok(
      await mcp.call("sauce_tx", {
        source: PAY,
        chain: "base",
        owner: OWNER,
        value: 0,
        args: [RECIPIENT, "1000000"],
      }),
    );
    assert.equal(out.chainId, 8453);
    assert.equal(out.to, v12PredictPot(OWNER, `0x${"00".repeat(32)}`));
    assert.equal(out.value, "0");
    const cook = decodeFunctionData({ abi: v12PotAbi, data: out.data as Hex });
    assert.equal(cook.functionName, "cook");
    assert.equal(getAddress(cook.args[0] as string), getAddress(v12EngineAddress()));
    const compiled = ok(await mcp.call("sauce_compile", { source: PAY, chain: "base" }));
    assert.ok((cook.args[1] as string).startsWith(compiled.bytecode as string));
    assert.ok((cook.args[1] as string).includes(RECIPIENT.slice(2).toLowerCase()));
    assert.ok((out.notes as string[]).some((note) => /cook\(\) is onlyOwner/.test(note)));
    // Who signs it; the fee as given, since no endpoint read it; and that it is not a rehearsal.
    assert.equal(out.from, OWNER);
    assert.equal(out.kitchenFee, null);
    assert.ok(
      (out.notes as string[]).some((note) => /fee was not read \(no endpoint\)/.test(note)),
    );
    assert.ok((out.notes as string[]).some((note) => /run sauce_simulate/.test(note)));
  });

  it("derives a named Pot from its salt label, or takes the Pot by address", async () => {
    const named = ok(
      await mcp.call("sauce_tx", {
        source: PAY,
        chain: "base",
        owner: OWNER,
        salt: "treasury",
        value: "0",
        args: [RECIPIENT, 1],
      }),
    );
    assert.equal(named.to, v12PredictPot(OWNER, potSalt("treasury")));
    const byAddress = ok(
      await mcp.call("sauce_tx", {
        source: PAY,
        chain: "base",
        pot: named.to,
        value: "0",
        args: [RECIPIENT, 1],
      }),
    );
    assert.equal(byAddress.data, named.data);
    assert.equal(byAddress.from, null, "a Pot's owner is read from the chain, and none was given");
  });

  it("says plainly what it needs that a server without an endpoint cannot give", async () => {
    const noValue = failed(
      await mcp.call("sauce_tx", {
        source: PAY,
        chain: "base",
        owner: OWNER,
        args: [RECIPIENT, 1],
      }),
    );
    assert.match(noValue, /missing value/);
    assert.match(noValue, /no endpoint for base/);
    const solana = failed(
      await mcp.call("sauce_tx", {
        source: SVM_PAY,
        chain: "solana",
        owner: SOLANA_OWNER,
        defines: { MINT },
        args: [1],
      }),
    );
    assert.match(solana, /needs an RPC endpoint for solana/);
    assert.match(solana, /Pass rpcUrl with the call/);
  });

  it("refuses arguments main does not take, and the wrong kind of Pot input", async () => {
    assert.match(
      failed(await mcp.call("sauce_tx", { source: PAY, chain: "base", owner: OWNER, value: 0 })),
      /takes 2 arguments/,
    );
    assert.match(
      failed(
        await mcp.call("sauce_tx", {
          source: PAY,
          chain: "base",
          owner: OWNER,
          pot: OWNER,
          value: 0,
          args: [RECIPIENT, 1],
        }),
      ),
      /not both/,
    );
    const potless = failed(
      await mcp.call("sauce_tx", { source: PAY, chain: "base", value: 0, args: [RECIPIENT, 1] }),
    );
    assert.match(potless, /give owner \(.*to simulate, any address will do\) or pot/);
  });
});

describe("sauce_reclaim", () => {
  it("refuses a chain that is not Solana, saying why, before any endpoint is asked", async () => {
    const message = failed(
      await mcp.call("sauce_reclaim", {
        chain: "base",
        owner: "4vJ9JU1bJJE96FWSJKvHsmmFADCg4gpZQff4P3bkLKi",
        rpcUrl: "https://127.0.0.1:9/",
      }),
    );
    assert.match(
      message,
      /sauce_reclaim is Solana's: a cook on base leaves no code buffer or lookup table open/,
    );
  });
  it("keeps what it cannot read the history of as in use, closes none of it, and says so", async () => {
    // An endpoint that finds one code buffer of the owner's, and answers no history.
    const owner = "4vJ9JU1bJJE96FWSJKvHsmmFADCg4gpZQff4P3bkLKi";
    const stub = await solanaRpcStub({
      scans: {
        [v12SvmKitchenProgramId()]: [
          { pubkey: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM", data: Buffer.alloc(91) },
        ],
      },
    });
    try {
      const out = ok(
        await mcp.call("sauce_reclaim", { chain: "solana", owner, rpcUrl: stub.url }),
      ) as {
        buffers: Array<{ inUse?: boolean; historyUnread?: boolean }>;
        transactions: unknown[];
        notes: string[];
      };
      assert.equal(out.buffers.length, 1);
      assert.equal(out.buffers[0]!.inUse, true);
      assert.equal(out.buffers[0]!.historyUnread, true);
      assert.deepEqual(out.transactions, []);
      assert.ok(
        out.notes.some((note) =>
          /^the history of 2 accounts \(1 code buffer\) could not be read: .+; it is kept as in use, and none is closed/.test(
            note,
          ),
        ),
        JSON.stringify(out.notes),
      );
      assert.ok(!JSON.stringify(out).includes(stub.url));
    } finally {
      await stub.close();
    }
  });
});

describe("sauce_pot", () => {
  it("predicts an EVM Pot and builds its unsigned deployment; deployed is unknown here", async () => {
    const out = ok(await mcp.call("sauce_pot", { chain: "base", owner: OWNER, salt: "vault" }));
    assert.equal(out.pot, v12PredictPot(OWNER, potSalt("vault")));
    assert.equal(out.to, getAddress(v12KitchenAddress()));
    assert.equal(out.value, "0");
    assert.equal(out.deployed, null);
    assert.ok((out.notes as string[]).some((note) => /was not checked/.test(note)));
  });

  it("predicts a Solana Pot and its create_pot instruction", async () => {
    const out = ok(await mcp.call("sauce_pot", { chain: "solana", owner: SOLANA_OWNER }));
    assert.equal(out.chain, "solana");
    assert.equal(typeof out.pot, "string");
    assert.ok((out.instruction as { accounts: unknown[] }).accounts.length > 0);
    assert.equal(out.deployed, null);
  });

  it("refuses an owner that is not an address", async () => {
    assert.match(failed(await mcp.call("sauce_pot", { chain: "base", owner: "me" })), /owner/);
  });
});

describe("sauce_simulate", () => {
  it("summarizes a result to what decides a trade", () => {
    const full = {
      ok: true,
      chain: "base",
      block: "7",
      from: OWNER,
      path: "eth_simulateV1",
      assumed: [{ slot: "0x01" }],
      gas: "5",
      gasKind: "used",
      transactions: [{ step: "cook", gas: "5" }],
      returns: "0x2a",
      returnType: "Uint256",
      returned: "42",
      transfers: [],
      approvals: [],
      nativeTransfers: null,
      balanceChanges: [],
      otherLogs: [{ data: "0x" }],
    };
    assert.deepEqual(simulateSummary(full), {
      ok: true,
      chain: "base",
      block: "7",
      returnType: "Uint256",
      returned: "42",
      gas: "5",
      gasKind: "used",
      transactions: [{ step: "cook", gas: "5" }],
      transfers: [],
      nativeTransfers: null,
      balanceChanges: [],
    });
    // The raw return data stays only where main declares nothing to decode it as.
    const { returnType: _type, returned: _returned, ...untyped } = full;
    assert.equal(simulateSummary(untyped).returns, "0x2a");
    assert.deepEqual(simulateSummary({ ok: false, stage: "cook", reason: "no", from: OWNER }), {
      ok: false,
      stage: "cook",
      reason: "no",
    });
  });

  it("needs an endpoint, and says so plainly", async () => {
    const message = failed(
      await mcp.call("sauce_simulate", {
        source: PAY,
        chain: "base",
        owner: OWNER,
        args: [RECIPIENT, 1],
      }),
    );
    assert.match(message, /Simulating needs an RPC endpoint for base \(chain id 8453\)/);
    assert.match(message, /Pass rpcUrl with the call/);
  });
});

describe("sauce_intent_publish", () => {
  const args = {
    source: INTENT,
    args: [RECIPIENT],
    intentDeadline: 2_000_000_000,
    intentCreator: CREATOR,
  };

  type Published = {
    chainId: number;
    intents: Array<{
      intentHash: string;
      destination: string;
      fundVia: string;
      vault: string;
      transactions: Array<{ what: string; to: string; data: string; value: string }>;
    }>;
    notes: string[];
  };

  it("builds the unsigned transfer into the vault and publish of a fixed intent", async () => {
    const out = ok(await mcp.call("sauce_intent_publish", args)) as Published;
    assert.equal(out.chainId, 1);
    assert.equal(out.intents.length, 1);
    assert.equal(out.intents[0]!.destination, "base");
    assert.match(out.intents[0]!.intentHash, /^0x[0-9a-f]{64}$/);
    assert.equal(out.intents[0]!.fundVia, "transfer");
    assert.match(out.intents[0]!.vault, /^0x[0-9a-fA-F]{40}$/);
    // The transfer first, then the publication: the vault is paid before the intent is announced.
    assert.deepEqual(
      out.intents[0]!.transactions.map((tx) => tx.what.split(" ")[0]),
      ["transfer", "publish"],
    );
    assert.ok(out.notes.some((note) => /Send them in order/.test(note)));
    assert.ok(out.notes.some((note) => /The transfers come first/.test(note)));
  });

  it("builds the approve and publishAndFund instead with intentFundVia publishAndFund", async () => {
    const out = ok(
      await mcp.call("sauce_intent_publish", { ...args, intentFundVia: "publishAndFund" }),
    ) as Published;
    assert.equal(out.intents[0]!.fundVia, "publishAndFund");
    assert.deepEqual(
      out.intents[0]!.transactions.map((tx) => tx.what.split(" ")[0]),
      ["approve", "publishAndFund"],
    );
  });

  it("needs a wallet and an endpoint for a dry run, and dryRun for assumed balances", async () => {
    assert.match(
      failed(await mcp.call("sauce_intent_publish", { ...args, dryRun: true })),
      /needs whose wallet/,
    );
    assert.match(
      failed(await mcp.call("sauce_intent_publish", { ...args, dryRun: true, from: OWNER })),
      /A dry run needs an RPC endpoint for ethereum/,
    );
    assert.match(
      failed(await mcp.call("sauce_intent_publish", { ...args, assumeBalance: ["USDC:1"] })),
      /goes with dryRun/,
    );
  });

  it("builds an intent paying a Solana wallet, given in base58, as the command does", async () => {
    const out = ok(
      await mcp.call("sauce_intent_publish", {
        source: [
          "function main(recipient: Address, amount: Uint256) {",
          "  Solana(() => {",
          "    USDC.transfer(recipient, amount);",
          "  }).reward({ tokens: [{ token: USDC, amount: 2000000 }] });",
          "}",
        ].join("\n"),
        chain: "base",
        args: ["9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM", "1000000"],
        intentDeadline: 2_000_000_000,
        intentCreator: CREATOR,
      }),
    ) as Published;
    assert.equal(out.intents[0]!.destination, "solana");
    // With no Solana endpoint, the wallet's token account is created whether or not it exists.
    assert.ok(out.notes.some((note) => /no solana endpoint: the route creates each/.test(note)));
  });

  it("refuses a Solana program body with no endpoint to read whether its Pot exists", async () => {
    assert.match(
      failed(
        await mcp.call("sauce_intent_publish", {
          source: [
            "function main(recipient: Address, amount: Uint256) {",
            "  Solana(() => {",
            "    const sent = amount;",
            "    USDC.transfer(recipient, sent);",
            "  }, { tokens: [{ token: USDC, amount }] }).reward({ tokens: [{ token: USDC, amount: 2000000 }] });",
            "}",
          ].join("\n"),
          chain: "base",
          args: ["9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM", "1000000"],
          intentDeadline: 2_000_000_000,
          intentCreator: CREATOR,
          intentExecutionFee: "5000",
        }),
      ),
      /runs a program on the Pot its Portal's executor owns[^]*give solana's endpoint/,
    );
  });

  it("refuses a program that does more than open fixed intents", async () => {
    assert.match(
      failed(
        await mcp.call("sauce_intent_publish", {
          source: PAY,
          chain: "base",
          args: [RECIPIENT, "1"],
        }),
      ),
      /opens no intent/,
    );
  });
});

describe("sauce_inspect", () => {
  it("takes the cook sauce_tx built back apart, checked against its source", async () => {
    const tx = ok(
      await mcp.call("sauce_tx", {
        source: PAY,
        chain: "base",
        owner: OWNER,
        value: 0,
        args: [RECIPIENT, "1000000"],
      }),
    );
    const out = ok(await mcp.call("sauce_inspect", { hex: tx.data, chain: "base", source: PAY }));
    assert.equal(out.call, "Pot.cook");
    assert.deepEqual(out.engine, { address: getAddress(v12EngineAddress()), released: true });
    const program = out.program as {
      source: { matches: boolean; arguments: Array<{ name: string; value: string }> };
    };
    assert.equal(program.source.matches, true, "the cook carries the source's program");
    assert.deepEqual(
      program.source.arguments.map(({ name, value }) => [name, value]),
      [
        ["recipient", RECIPIENT],
        ["amount", "1000000"],
      ],
    );
  });

  it("lists the intents a program opens, from its source alone", async () => {
    const out = ok(
      await mcp.call("sauce_inspect", {
        source: INTENT,
        args: [RECIPIENT],
        intentDeadline: "2000000000",
        intentCreator: CREATOR,
      }),
    );
    assert.match(JSON.stringify(out), /base/);
    assert.match(
      failed(await mcp.call("sauce_inspect", { hex: "0x00", args: [RECIPIENT] })),
      /a cook's are decoded from its hex/,
    );
  });

  it("needs an endpoint and a chain for a transaction hash, and hex to be hex", async () => {
    assert.match(
      failed(await mcp.call("sauce_inspect", { hex: `0x${"ab".repeat(32)}` })),
      /give the chain it is on/,
    );
    assert.match(
      failed(await mcp.call("sauce_inspect", { hex: `0x${"ab".repeat(32)}`, chain: "base" })),
      /needs an RPC endpoint for base/,
    );
    assert.match(failed(await mcp.call("sauce_inspect", { hex: "0xabc" })), /not 0x-prefixed/);
    assert.match(failed(await mcp.call("sauce_inspect", {})), /give hex/);
  });
});

describe("sauce_verify", () => {
  it("accepts the audited settle, with its tokens, minOut and recipient", async () => {
    const vector = SETTLE_VECTORS[0]!;
    const out = ok(await mcp.call("sauce_verify", { hex: settlePayload(vector.args) }));
    assert.equal(out.valid, true);
    assert.equal(out.programHash, SETTLE_WIRE.PROGRAM_HASH);
  });

  it("returns a rejection as a result with its code, not as an error", async () => {
    const rejection = SETTLE_REJECTIONS[0]!;
    const out = ok(await mcp.call("sauce_verify", { hex: settlePayload(rejection.args) }));
    assert.equal(out.valid, false);
    assert.equal(typeof out.code, "string");
  });

  it("needs an endpoint for a Solana cook", async () => {
    assert.match(
      failed(
        await mcp.call("sauce_verify", {
          chain: "solana",
          signature: "5".repeat(88),
          minOut: 0,
          splCount: 1,
        }),
      ),
      /needs an RPC endpoint for solana/,
    );
  });
});
