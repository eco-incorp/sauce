/**
 * Every tool, in process over an in-memory transport, with no endpoint configured — so nothing
 * here reaches a network — and each held to what the `sauce` command computes for the same input:
 * the tools are the command's functions, and a tool that drifted from its command would show here.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { decodeFunctionData, getAddress, type Hex } from "viem";

import { v12EngineAddress, v12KitchenAddress } from "../../sdk/dist/deployments/index.js";
import { potSalt, v12PredictPot } from "../../sdk/dist/deployments/pot.js";
import { v12PotAbi } from "../../sdk/dist/evm/engine.js";
import {
  SETTLE_REJECTIONS,
  SETTLE_VECTORS,
  SETTLE_WIRE,
  settlePayload,
} from "../../sdk/dist/verify/index.js";
import { SKILL_TOOL_NAMES } from "../src/skilltools.js";
import { TOOL_NAMES } from "../src/tools.js";
import { connect, failed, ok, type Connected } from "./harness.js";

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
  "// @chain arbitrum",
  "Base(() => {",
  "  USDC.transfer(RECIPIENT, 5n);",
  "}).reward({ tokens: [{ token: USDC, amount: 7n }] });",
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
  it("is every tool, each with an input and an output schema and read-only annotations", async () => {
    const { tools } = await mcp.client.listTools();
    assert.deepEqual(
      tools.map((tool) => tool.name),
      [...TOOL_NAMES, ...SKILL_TOOL_NAMES],
    );
    for (const tool of tools) {
      assert.equal(tool.inputSchema.type, "object", `${tool.name} takes an object`);
      assert.equal(tool.outputSchema?.type, "object", `${tool.name} declares its output`);
      assert.ok((tool.description ?? "").length > 80, `${tool.name} says what it does`);
      assert.equal(tool.annotations?.readOnlyHint, true, `${tool.name} is read-only`);
      assert.equal(tool.annotations?.destructiveHint, false);
      // No tool takes a key, under any name.
      const fields = Object.keys(tool.inputSchema.properties ?? {});
      for (const field of fields) {
        assert.doesNotMatch(field, /key|secret|password|mnemonic|seed|keystore|keypair/i);
      }
    }
  });

  it("tells a client what the server is, that it never signs, and where the skills are", () => {
    const instructions = mcp.client.getInstructions() ?? "";
    assert.match(instructions, /NOTHING HERE SIGNS OR SENDS/);
    assert.match(instructions, /sauce:\/\/skills\/index/);
    assert.match(instructions, /has no endpoint of its own/);
    assert.match(instructions, /rpcUrl/);
  });
});

describe("sauce_chains", () => {
  it("lists every chain, and none with an endpoint on a server without a config", async () => {
    const { chains } = ok(await mcp.call("sauce_chains")) as {
      chains: Array<{ slug: string; id: number; kind: string; endpoint: boolean }>;
    };
    assert.ok(chains.some((chain) => chain.slug === "base" && chain.id === 8453));
    assert.ok(chains.some((chain) => chain.kind === "svm"));
    assert.ok(chains.every((chain) => chain.endpoint === false));
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

  it("names an unknown chain or namespace as the error", async () => {
    assert.match(failed(await mcp.call("sauce_globals", { chain: "nowhere" })), /nowhere/);
    assert.match(
      failed(await mcp.call("sauce_globals", { chain: "base", protocol: "NoSuchThing" })),
      /NoSuchThing/,
    );
  });
});

describe("sauce_price", () => {
  it("turns a price into the pool's sqrtPriceX96 and both directions' floors, and back", async () => {
    const out = ok(
      await mcp.call("sauce_price", { chain: "base", base: "WETH", quote: "USDC", price: "2700" }),
    ) as { sqrtPriceX96: string; sell: { minAvgPrice: string }; buy: { minAvgPrice: string } };
    assert.match(out.sqrtPriceX96, /^\d+$/);
    assert.ok(BigInt(out.sell.minAvgPrice) > 0n && BigInt(out.buy.minAvgPrice) > 0n);
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
    type Side = { price: string; sqrtPriceLimitX96: string; minAvgPrice: string };
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
    const worst = (await at("2721.664994984954864593781344")).buy.minAvgPrice;
    assert.equal(out.limits.buy.minAvgPrice, worst);
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
});

describe("sauce_compile", () => {
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
    assert.deepEqual(out.defines, { RECIPIENT, AMOUNT: "1000000" });
    assert.equal((out.engine as { release: string }).release, "v12-evm");
    assert.equal((out.compiler as { name: string }).name, "@eco-incorp/sauce-compiler");
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
    assert.deepEqual(out.defines, { MINT });
    const manifest = out.manifest as { accounts: Array<{ name?: string; kind: string }> };
    assert.deepEqual(
      manifest.accounts.filter((entry) => entry.kind === "slot").map((entry) => entry.name),
      ["tokenProgram", "source", "destination", "authority"],
    );
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
    assert.match(potless, /give owner \(.*to rehearse, any address will do\) or pot/);
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
    defines: { RECIPIENT },
    intentDeadline: 2_000_000_000,
    intentCreator: CREATOR,
  };

  it("builds the unsigned approve and publishAndFund of a fixed intent", async () => {
    const out = ok(await mcp.call("sauce_intent_publish", args)) as {
      chainId: number;
      intents: Array<{
        intentHash: string;
        destination: string;
        transactions: Array<{ what: string; to: string; data: string; value: string }>;
      }>;
      notes: string[];
    };
    assert.equal(out.chainId, 42161);
    assert.equal(out.intents.length, 1);
    assert.equal(out.intents[0]!.destination, "base");
    assert.match(out.intents[0]!.intentHash, /^0x[0-9a-f]{64}$/);
    assert.deepEqual(
      out.intents[0]!.transactions.map((tx) => tx.what.split(" ")[0]),
      ["approve", "publishAndFund"],
    );
    assert.ok(out.notes.some((note) => /Send them in order/.test(note)));
  });

  it("needs a wallet and an endpoint for a dry run, and dryRun for assumed balances", async () => {
    assert.match(
      failed(await mcp.call("sauce_intent_publish", { ...args, dryRun: true })),
      /needs whose wallet/,
    );
    assert.match(
      failed(await mcp.call("sauce_intent_publish", { ...args, dryRun: true, from: OWNER })),
      /A dry run needs an RPC endpoint for arbitrum/,
    );
    assert.match(
      failed(await mcp.call("sauce_intent_publish", { ...args, assumeBalance: ["USDC:1"] })),
      /goes with dryRun/,
    );
  });

  it("refuses a program that does more than open fixed intents", async () => {
    assert.match(
      failed(await mcp.call("sauce_intent_publish", { source: PAY, chain: "base" })),
      /opens no intent/,
    );
  });
});

describe("sauce_intent_fill", () => {
  const intent = {
    source: [
      "Base(() => {",
      "  USDC.transfer(RECIPIENT, 5n);",
      "}).reward({ tokens: [{ token: USDC, amount: 7n }] });",
      "",
    ].join("\n"),
    chain: "arbitrum",
    defines: { RECIPIENT },
    intentDeadline: 2_000_000_000,
    intentCreator: OWNER,
  };

  it("takes the destination's endpoint one way, a claimant of 20 or 32 bytes", async () => {
    assert.match(
      failed(
        await mcp.call("sauce_intent_fill", {
          ...intent,
          rpcUrl: "http://127.0.0.1:9/",
          rpcUrls: { base: "http://127.0.0.1:9/" },
        }),
      ),
      /give rpcUrl \(one destination\) or rpcUrls \(by chain\), not both/,
    );
    assert.match(
      failed(await mcp.call("sauce_intent_fill", { ...intent, claimant: "0x1234" })),
      /claimant: '0x1234' is neither an address \(20 bytes\) nor 32 bytes of hex/,
    );
    assert.match(
      failed(
        await mcp.call("sauce_intent_fill", {
          ...intent,
          rpcUrls: { nowhere: "http://127.0.0.1:9/" },
        }),
      ),
      /nowhere/,
    );
  });

  it("names the destination it needs an endpoint for", async () => {
    const message = failed(await mcp.call("sauce_intent_fill", intent));
    assert.match(message, /Rehearsing a fill needs an RPC endpoint for base \(chain id 8453\)/);
    assert.match(message, /Pass rpcUrl with the call/);
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
        defines: { RECIPIENT },
        intentDeadline: "2000000000",
        intentCreator: CREATOR,
      }),
    );
    assert.match(JSON.stringify(out), /base/);
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
