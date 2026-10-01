/**
 * Tokens by registry symbol, protocol contracts by namespace, and pools by key: the spelling a
 * Sauce program uses, in an action document. Parsed offline, then compiled through the real
 * compiler for more than one chain — a document that names everything is chain-agnostic, and a
 * name a chain lacks is refused with its path, the chain and the name. No chain state is read.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Ajv2020 } from "ajv/dist/2020.js";

import { sourceGlobals } from "../../sdk/dist/routes/index.js";
import {
  ProgramError,
  compileProgram,
  compileSplitSwap,
  parseProgram,
  programIntent,
  programSchema,
  quoteAction,
} from "../src/index.js";
import { ACTION_SPECS, ACTION_TYPES, type FieldKind } from "../src/spec.js";
import type { Action, ActionProgram, ActionType } from "../src/types.js";
import { SAMPLES } from "./samples.js";

/** Chains whose registries both carry everything the named documents below use. */
const CHAINS = ["ethereum", "base"] as const;

const addressOf = (chain: string, name: string): string => {
  const globals = sourceGlobals(chain);
  const [ns, contract] = name.split(".");
  const found =
    contract === undefined
      ? globals.tokens.find((t) => t.symbol === name)?.address
      : globals.protocols
          .find((p) => p.namespace === ns)
          ?.contracts.find((c) => c.name === contract)?.address;
  assert.ok(found, `${name} on ${chain}`);

  return found;
};

const doc = (...actions: object[]): ActionProgram =>
  ({ version: 1, actions }) as unknown as ActionProgram;

/** Every problem `input` has, as `path: message` lines — from parsing, or from compiling it. */
function problems(run: () => unknown): string[] {
  try {
    run();
  } catch (error) {
    if (!(error instanceof ProgramError)) throw error;
    return error.issues.map((i) => `${i.path}: ${i.message}`);
  }
  assert.fail("expected the program to be refused");
}

/** A swap of USDC for WETH through the pool Uniswap V3's factory keys at 0.05%. */
const V3_BY_KEY = {
  type: "uniswapV3Swap",
  amount: "1000000",
  tokenIn: "USDC",
  tokenOut: "WETH",
  factory: "UniswapV3.Factory",
  fee: 500,
  amountOutMin: "0",
  recipient: "self",
};

const NAMED = doc(
  { type: "argument", name: "amount" },
  { ...V3_BY_KEY, amount: undefined, saveOutputAs: "weth" },
  {
    type: "uniswapV2Swap",
    amountRef: "weth",
    tokenIn: "WETH",
    tokenOut: "USDC",
    factory: "UniswapV2.Factory",
    amountOutMin: "0",
    recipient: "self",
  },
  { type: "approve", token: "USDC", spender: "Permit2.Permit2" },
  {
    type: "uniswapV4Swap",
    poolManager: "UniswapV4.PoolManager",
    tokenIn: "USDC",
    tokenOut: "native",
    fee: 500,
    tickSpacing: 10,
    amountOutMin: "0",
    recipient: "self",
  },
);

describe("names — parsing", () => {
  it("takes a symbol, a namespace reference, `native` where it is the venue's, or an address", () => {
    const program = parseProgram(JSON.parse(JSON.stringify(NAMED)));
    assert.equal(program.chainId, undefined, "no chainId: the document is chain-agnostic");
    assert.deepEqual(program, parseProgram(program), "names are kept as written");
  });

  const refused: [string, object, RegExp][] = [
    [
      "a lower-case symbol, with the spelling it means",
      { ...SAMPLES.approve, token: "usdc" },
      /actions\[0\]\.token: expected a registry token symbol .* — symbols are upper case: did you mean "USDC"\?/,
    ],
    [
      "a namespace reference where a token goes",
      { ...SAMPLES.approve, token: "UniswapV3.Factory" },
      /actions\[0\]\.token: "UniswapV3\.Factory" is a protocol contract, and this field is a token/,
    ],
    [
      "a symbol where a contract goes",
      { ...SAMPLES.approve, spender: "USDC" },
      /actions\[0\]\.spender: "USDC" is a token symbol, and this field is a protocol contract/,
    ],
    [
      "native where the venue does not take it",
      { ...SAMPLES.transfer, token: "native" },
      /actions\[0\]\.token: "native" is not a token this field takes/,
    ],
    [
      "ETH for the native currency",
      { ...SAMPLES.uniswapV4Swap, tokenIn: "eth" },
      /actions\[0\]\.tokenIn: .*the native currency is "native"/,
    ],
    [
      "a pool and a factory together",
      { ...V3_BY_KEY, pool: SAMPLES.uniswapV3Swap.pool },
      /actions\[0\]\.(pool|factory|fee): .* cannot go with .*: give exactly one of `pool`, or `factory` \+ `fee`, or `factory` \+ `tickSpacing`/,
    ],
    [
      "neither a pool nor its key",
      { ...V3_BY_KEY, factory: undefined, fee: undefined },
      /actions\[0\]\.pool: missing: give `pool`, or `factory` \+ `fee`, or `factory` \+ `tickSpacing`/,
    ],
    [
      "a factory without its key",
      { ...V3_BY_KEY, fee: undefined },
      /actions\[0\]\.fee: missing: with `factory`, give `fee` too/,
    ],
    [
      "a fee and a tick spacing both",
      { ...V3_BY_KEY, tickSpacing: 100 },
      /actions\[0\]\.tickSpacing: `tickSpacing` cannot go with `factory` \+ `fee`/,
    ],
    [
      "a key beside a pool",
      { ...SAMPLES.uniswapV3Swap, fee: 500 },
      /actions\[0\]\.fee: `fee` cannot go with `pool`/,
    ],
    [
      "an LB pair's tokenX without its tokenY",
      { ...SAMPLES.traderJoeLBSwap, tokenY: undefined },
      /actions\[0\]\.tokenY: missing: `tokenX` \+ `tokenY` go together/,
    ],
  ];
  for (const [name, action, expected] of refused) {
    it(`refuses ${name}`, () => {
      const input = JSON.parse(JSON.stringify(doc(action)));
      const found = problems(() => parseProgram(input));
      assert.ok(
        found.some((line) => expected.test(line)),
        `no issue matched ${expected}:\n  ${found.join("\n  ")}`,
      );
    });
  }

  it("the published schema agrees: it accepts the names and refuses the same alternatives", () => {
    const validate = new Ajv2020({ allErrors: true, strict: true }).compile(programSchema());
    assert.ok(validate(JSON.parse(JSON.stringify(NAMED))), JSON.stringify(validate.errors));
    for (const [name, action] of refused) {
      if (name.startsWith("ETH")) continue; // "eth" is neither a symbol nor an address either way
      const input = JSON.parse(JSON.stringify(doc(action)));
      assert.equal(validate(input), false, `the schema accepted ${name}`);
    }
  });
});

describe("names — one document, compiled for each chain", () => {
  it("compiles the same source for every chain, each to that chain's addresses", () => {
    const compiled = CHAINS.map((chain) => compileProgram(NAMED, { chain }));
    assert.equal(compiled[0]!.source, compiled[1]!.source, "the source carries the names");
    assert.notDeepEqual(compiled[0]!.bytecode, compiled[1]!.bytecode, "each chain's addresses");
    for (const program of compiled) assert.deepEqual(program.parameters, ["amount"]);
    assert.match(compiled[0]!.source, /UniswapV3\.Factory\.getPool\(USDC, WETH, 500n\)/);
    assert.match(compiled[0]!.source, /UniswapV2\.Factory\.getPair\(WETH, USDC\)/);
    assert.match(
      compiled[0]!.source,
      /require\(pool\d+ != 0n, "actions\[1\]: no pool under that key"\)/,
    );
    assert.match(compiled[0]!.source, /uniswapV4\(UniswapV4\.PoolManager, USDC, 0n,/);
  });

  for (const chain of CHAINS) {
    // Where a value is an argument or a call's target, a name and its address compile alike. (An
    // ERC-20 write's spender or recipient differs: a literal is spliced into calldata encoded when
    // the program is built, a name — not known until the compile — is encoded while it runs.)
    it(`a name compiles to exactly the bytes its address does on ${chain}`, () => {
      const pool = "0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640";
      const named = doc(
        { type: "balanceOf", token: "USDC" },
        { ...V3_BY_KEY, amount: undefined, factory: undefined, fee: undefined, pool },
        { type: "transfer", token: "WETH", recipient: "self" },
      );
      const addressed = doc(
        { type: "balanceOf", token: addressOf(chain, "USDC") },
        {
          ...V3_BY_KEY,
          amount: undefined,
          factory: undefined,
          fee: undefined,
          pool,
          tokenIn: addressOf(chain, "USDC"),
          tokenOut: addressOf(chain, "WETH"),
        },
        { type: "transfer", token: addressOf(chain, "WETH"), recipient: "self" },
      );
      assert.deepEqual(
        compileProgram(JSON.parse(JSON.stringify(named)), { chain }).bytecode,
        compileProgram(JSON.parse(JSON.stringify(addressed)), { chain }).bytecode,
      );
    });
  }

  /**
   * Every token and contract field of every action, given by name. The names are ones every chain
   * here carries — a contract field takes `Permit2.Permit2` as its stand-in — so the test is of
   * where a name may stand, not of which contract belongs there; a pool key's factory, whose kind
   * IS checked, is the real one.
   */
  function named(type: ActionType, n = 0): Action {
    const fill = (value: unknown, kind: FieldKind): unknown => {
      switch (kind.k) {
        case "token":
          return ["USDC", "WETH"][n++ % 2];
        case "tokenContract":
          return "WETH";
        case "contract":
          return "Permit2.Permit2";
        case "array":
          return (value as unknown[]).map((item) => fill(item, kind.of));
        default:
          return value;
      }
    };
    const sample = structuredClone(SAMPLES[type]) as unknown as Record<string, unknown>;
    for (const [key, def] of Object.entries(ACTION_SPECS[type].fields)) {
      if (sample[key] !== undefined) sample[key] = fill(sample[key], def.kind);
    }

    return sample as unknown as Action;
  }
  const reader = (type: ActionType): object[] =>
    ACTION_SPECS[type].group === "source"
      ? [
          type === "nativeBalance"
            ? { type: "wrapETH", weth: "WETH" }
            : { type: "approve", token: "USDC", spender: "Permit2.Permit2" },
        ]
      : [];

  for (const type of ACTION_TYPES) {
    it(`${type}: every token and contract by name compiles on ${CHAINS.join(" and ")}`, () => {
      const program = doc(named(type), ...reader(type));
      const sources = CHAINS.map((chain) => compileProgram(program, { chain }).source);
      assert.equal(sources[0], sources[1]);
    });
  }

  for (const [label, key] of [
    ["a V2 pair by its factory", { factory: "UniswapV2.Factory" }],
    ["a V3 pool by its factory and fee", { factory: "UniswapV3.Factory", fee: 3000 }],
  ] as const) {
    it(`${label} compiles on ${CHAINS.join(" and ")}`, () => {
      const base = label.includes("V2") ? SAMPLES.uniswapV2Swap : SAMPLES.uniswapV3Swap;
      const program = doc({ ...base, pool: undefined, ...key, tokenIn: "USDC", tokenOut: "WETH" });
      for (const chain of CHAINS) assert.ok(compileProgram(program, { chain }).bytecode.length > 0);
    });
  }

  it("a factory given by address is called through the actions' own binding", () => {
    const factory = addressOf("ethereum", "UniswapV3.Factory");
    const { source, contracts } = compileProgram(doc({ ...V3_BY_KEY, factory }), {
      chain: "ethereum",
    });
    assert.match(source, /IUniswapV3Factory\.at\(0x[0-9a-f]{40}n\)\.getPool\(USDC, WETH, 500n\)/);
    assert.ok("IUniswapV3Factory" in contracts);
  });

  it("an LB pair by its factory reads the pair, and its tokens when they are left out", () => {
    const factory = "0x1000000000000000000000000000000000000009";
    const { source } = compileProgram(
      doc({
        ...SAMPLES.traderJoeLBSwap,
        pool: undefined,
        tokenX: undefined,
        tokenY: undefined,
        factory,
        binStep: 20,
      }),
      { chain: "ethereum" },
    );
    assert.match(source, /ILBFactory\.at\(0x[0-9a-f]+n\)\.getLBPairInformation\(.*, 20n\)/);
    assert.match(source, /const pool\d+ = pool\d+\.LBPair;/);
    assert.match(source, /ILBPair\.at\(pool\d+\)\.getTokenX\(\)/);
  });

  it("opens an intent on the chain it is given, resolving the names there", () => {
    const person = "0x6000000000000000000000000000000000000004";
    const options = {
      pot: "0x6000000000000000000000000000000000000001",
      engine: "0x6000000000000000000000000000000000000002",
      portal: "0x6000000000000000000000000000000000000003",
      deadline: 2_000_000_000n,
    } as const;
    const reward = {
      source: "base",
      creator: person,
      prover: person,
      deadline: 2_000_000_200n,
      nativeAmount: 1n,
    } as const;
    const program = doc(
      { type: "balanceOf", token: "USDC" },
      { type: "approve", token: "USDC", spender: "Permit2.Permit2" },
    );
    for (const chain of CHAINS) {
      const built = programIntent(program, { ...options, chain }).reward(reward);
      assert.equal(built.destination.slug, chain);
      assert.deepEqual(built.compiled.bytecode[0], compileProgram(program, { chain }).bytecode);
    }
  });
});

describe("names — refused on the chain that lacks them", () => {
  it("names the chain and the symbol, with its path", () => {
    const found = problems(() => compileProgram(NAMED, { chain: "avalanche" }));
    assert.ok(
      found.includes(
        'actions[1].tokenIn: no token "USDC" on Avalanche C-Chain (chain 43114), which registers ' +
          "no token symbols — give its address there instead",
      ),
      found.join("\n"),
    );
    try {
      compileProgram(NAMED, { chain: "avalanche" });
    } catch (error) {
      assert.match(
        (error as Error).message,
        /^the action program does not compile for Avalanche C-Chain \(avalanche, chain 43114\)/,
      );
      assert.equal((error as ProgramError).chain?.slug, "avalanche");
    }
  });

  it("lists the tokens a chain does register", () => {
    const found = problems(() =>
      compileProgram(doc({ ...SAMPLES.approve, token: "DAI" }), { chain: "base" }),
    );
    assert.match(
      found[0]!,
      /^actions\[0\]\.token: no token "DAI" on Base \(chain 8453\), whose tokens are .*USDC/,
    );
  });

  it("says what ETH is when it is used as a symbol", () => {
    const found = problems(() =>
      compileProgram(doc({ ...SAMPLES.approve, token: "ETH" }), { chain: "base" }),
    );
    assert.match(found[0]!, /the native currency is "native" .* wrapped ETH is "WETH"/);
  });

  it("names a contract a namespace does not have, and the ones it does", () => {
    const found = problems(() =>
      compileProgram(doc({ ...V3_BY_KEY, factory: "UniswapV3.Factroy" }), { chain: "base" }),
    );
    assert.match(
      found[0]!,
      /^actions\[0\]\.factory: UniswapV3 on Base \(chain 8453\) has no contract "Factroy"; it has .*Factory/,
    );
  });

  it("suggests the namespace a misspelt one means", () => {
    const found = problems(() =>
      compileProgram(doc({ ...V3_BY_KEY, factory: "UniswapV33.Factory" }), { chain: "base" }),
    );
    assert.match(found[0]!, /no protocol namespace "UniswapV33" — did you mean UniswapV3\?/);
  });

  it("refuses a factory of the wrong kind for the key, naming the ones that fit", () => {
    const found = problems(() =>
      compileProgram(doc({ ...V3_BY_KEY, factory: "UniswapV2.Factory" }), { chain: "base" }),
    );
    assert.match(
      found[0]!,
      /^actions\[0\]\.factory: "UniswapV2\.Factory" has no getPool\(address,address,uint24\): this action's factory is a Uniswap V3-style factory.*UniswapV3\.Factory/,
    );
  });

  it('refuses wrapping "WETH" where it is not the wrapped native, and takes it where it is', () => {
    const wrap = doc({ type: "wrapETH", amount: "1", weth: "WETH" });
    const found = problems(() => compileProgram(wrap, { chain: "polygon" }));
    assert.match(
      found[0]!,
      /^actions\[0\]\.weth: on Polygon \(chain 137\) the native coin is \w+, and the registry's "WETH" is bridged ETH/,
    );
    for (const chain of ["ethereum", "base", "arbitrum", "optimism"]) {
      assert.ok(compileProgram(wrap, { chain }).bytecode.length > 0, chain);
    }
    // By symbol or address, the wrapped native itself is taken as given.
    for (const weth of ["WPOL", addressOf("polygon", "WPOL")]) {
      const program = doc({ type: "wrapETH", amount: "1", weth });
      assert.ok(compileProgram(program, { chain: "polygon" }).bytecode.length > 0, weth);
    }
  });

  it("checks the rules a name decides once it is resolved: a token swapped for itself", () => {
    const found = problems(() =>
      compileProgram(doc({ ...V3_BY_KEY, tokenOut: addressOf("base", "USDC") }), { chain: "base" }),
    );
    assert.deepEqual(found, ["actions[0].tokenOut: is tokenIn: a swap needs two tokens"]);
  });
});

describe("names — native", () => {
  it("measures a native output with the Pot's native balance, not an ERC-20 read of zero", () => {
    const ambient = {
      ...SAMPLES.ambientSwap,
      base: "native",
      isBuy: false,
      saveOutputAs: "eth",
    };
    const batch = {
      ...SAMPLES.balancerV2BatchSwap,
      assets: [SAMPLES.balancerV2BatchSwap.assets[0], "native"],
      saveOutputAs: "eth",
    };
    for (const action of [ambient, batch]) {
      const { source } = compileProgram(
        doc(action, { type: "wrapETH", amountRef: "eth", weth: "WETH" }),
        { chain: "ethereum" },
      );
      assert.match(source, /ctx\.selfBalance\(\)/, action.type);
      assert.doesNotMatch(source, /IErc20\.at\(0n\)/, action.type);
    }
  });

  it("quotes a native leg at the zero address, with no chain to resolve it on", () => {
    const router = "0x5000000000000000000000000000000000000005";
    const v4 = { ...SAMPLES.uniswapV4Swap, tokenIn: "native" };
    const zero = {
      ...SAMPLES.uniswapV4Swap,
      tokenIn: "0x0000000000000000000000000000000000000000",
    };
    assert.equal(
      quoteAction(v4 as never, { router }).data,
      quoteAction(zero as never, { router }).data,
    );
  });
});

describe("names — the chain a document compiles for", () => {
  it("needs a chain when the document names none", () => {
    assert.throws(() => compileProgram(NAMED), /has no `chainId`, so say which chain/);
  });

  it("compiles a document with a chainId for that chain, and refuses another", () => {
    const pinned = { ...NAMED, chainId: 1 };
    assert.ok(compileProgram(pinned).bytecode.length > 0);
    assert.ok(compileProgram(pinned, { chain: "ethereum" }).bytecode.length > 0);
    const found = problems(() => compileProgram(pinned, { chain: "base" }));
    assert.match(
      found[0]!,
      /^chainId: the program is written for chain 1, not Base \(base, chain 8453\)/,
    );
  });

  it("refuses a chain the SDK does not know, and a chain that is not an EVM one", () => {
    assert.throws(() => compileProgram(NAMED, { chain: 31337 }), /unknown chain "31337"/);
    assert.throws(() => compileProgram(NAMED, { chain: "solana" }), /run on EVM chains; solana/);
  });
});

describe("names — quotes", () => {
  it("resolves the names on the chain it is given", () => {
    const router = "0x5000000000000000000000000000000000000005";
    const named = {
      type: "uniswapV3Swap" as const,
      amount: "1000",
      pool: "0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640" as const,
      tokenIn: "USDC",
      tokenOut: "WETH",
      amountOutMin: "0",
      recipient: "self" as const,
    };
    const addressed = {
      ...named,
      tokenIn: addressOf("ethereum", "USDC"),
      tokenOut: addressOf("ethereum", "WETH"),
    };
    assert.deepEqual(
      quoteAction(named, { router, chain: "ethereum" }).data,
      quoteAction(addressed as never, { router }).data,
    );
    assert.throws(() => quoteAction(named, { router }), /pass `chain` to resolve it on/);
  });

  it("needs an LB pair's tokenX to quote it, which only the swap can read from the pair", () => {
    const lb = { ...SAMPLES.traderJoeLBSwap, tokenX: undefined, tokenY: undefined };
    assert.throws(
      () => quoteAction(JSON.parse(JSON.stringify(lb))),
      /quoting a traderJoeLBSwap needs its tokenX and tokenY/,
    );
  });

  it("resolves a contract by namespace for a quote too, to the address it names", () => {
    const named = {
      ...SAMPLES.balancerV2Swap,
      vault: "BalancerV2.Vault",
      tokenIn: "USDC",
      tokenOut: "WETH",
    };
    const addressed = {
      ...named,
      vault: addressOf("ethereum", "BalancerV2.Vault"),
      tokenIn: addressOf("ethereum", "USDC"),
      tokenOut: addressOf("ethereum", "WETH"),
    };
    const quote = quoteAction(named as never, { chain: "ethereum" });
    assert.deepEqual(quote, { ...quoteAction(addressed as never), decode: quote.decode });
    assert.equal(quote.to.toLowerCase(), addressOf("ethereum", "BalancerV2.Vault").toLowerCase());
  });

  it("a split swap refuses a candidate whose pool is named by its key", () => {
    const { amount: _, ...candidate } = V3_BY_KEY;
    assert.throws(
      () =>
        compileSplitSwap({
          candidates: [candidate as never],
          amount: "1000",
          buckets: 1,
          amountOutMin: "0",
          chain: "ethereum",
        }),
      /candidates\[0\]\.factory: a split quotes each candidate at its pool's address/,
    );
  });

  it("refuses a pool named by its key: a quote is an eth_call at the pool's address", () => {
    assert.throws(
      () =>
        quoteAction(V3_BY_KEY as never, { router: "0x5000000000000000000000000000000000000005" }),
      /a pool named by its key \(`factory`\) is found only on chain/,
    );
  });
});
