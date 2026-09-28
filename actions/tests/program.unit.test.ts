/**
 * The JSON form of an action program: strict parsing, located errors, canonical round trips, and
 * the published JSON Schema agreeing with the parser. Offline.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";

import {
  ProgramError,
  compileProgram,
  parseProgram,
  programSchema,
  serializeProgram,
} from "../src/index.js";
import { ACTION_TYPES } from "../src/spec.js";
import type { ActionProgram } from "../src/types.js";
import { REPO_ROOT } from "./anvil.js";
import { SAMPLES, sampleProgram } from "./samples.js";

const USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const ROUTER = "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45";

/** The issues `input` produces, as `path: message` lines. */
function issues(input: unknown): string[] {
  try {
    parseProgram(input);
  } catch (error) {
    if (!(error instanceof ProgramError)) throw error;
    return error.issues.map((i) => `${i.path}: ${i.message}`);
  }
  assert.fail("expected the program to be rejected");
}

function rejects(input: unknown): boolean {
  return issues(input).length > 0;
}

function withAction(action: object, extra: object[] = []) {
  return { version: 1, chainId: 1, actions: [action, ...extra] };
}

describe("action programs — every action type round-trips", () => {
  for (const type of ACTION_TYPES) {
    it(`${type}: parse -> serialize -> parse is the identity, and it compiles`, () => {
      const program = parseProgram(sampleProgram(type));
      assert.deepEqual(program, sampleProgram(type), "parsing fills in nothing");
      const text = serializeProgram(program);
      assert.deepEqual(parseProgram(text), program);
      assert.equal(serializeProgram(parseProgram(JSON.parse(text))), text);
      assert.ok(compileProgram(program).bytecode.length > 0);
    });
  }

  it("serialization is canonical: key order in the input does not matter", () => {
    const shuffled = {
      actions: [Object.fromEntries(Object.entries(SAMPLES.uniswapV3ExactInput).reverse())],
      chainId: 1,
      version: 1,
    };
    assert.equal(
      serializeProgram(parseProgram(shuffled)),
      serializeProgram(sampleProgram("uniswapV3ExactInput")),
    );
  });

  it("parsing copies: mutating the input afterwards does not change the program", () => {
    const input = sampleProgram("approve") as unknown as { actions: Record<string, unknown>[] };
    const program = parseProgram(input);
    input.actions[0]!.amount = "5";
    assert.equal((program.actions[0] as { amount?: string }).amount, "1000");
  });

  it("JSON text parses the same as the object", () => {
    const program = sampleProgram("curveSwap");
    assert.deepEqual(parseProgram(JSON.stringify(program)), parseProgram(program));
  });
});

describe("action programs — chaining is part of the document", () => {
  const program: ActionProgram = parseProgram({
    version: 1,
    chainId: 1,
    actions: [
      {
        type: "wrapETH",
        weth: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
        amount: "1000000000000000000",
      },
      { type: "approve", token: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", spender: ROUTER },
      {
        type: "uniswapV3ExactInput",
        router: ROUTER,
        tokenIn: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
        tokenOut: USDC,
        fee: 500,
        amountOutMin: "1",
        recipient: "self",
        saveOutputAs: "usdc",
      },
      {
        type: "transfer",
        token: USDC,
        recipient: "0x3000000000000000000000000000000000000001",
        amountRef: "usdc",
      },
    ],
  });

  it("implicit chaining and named outputs compile to locals", () => {
    const { source } = compileProgram(program);
    assert.match(source, /let t_out0 = 1000000000000000000n;/);
    assert.match(source, /let t_out1 = t_out0;/);
    // The approve spends the wrap's output and the transfer the saved swap output, each spliced into
    // an ERC-20 call checked like SafeERC20.
    assert.match(source, /hex`095ea7b3[0-9a-f]*68b3465833fb72a70ecdf485e0e4c7bd8665fc45`;/);
    assert.match(source, /\.concat\(t_out0\.toBytesBe\(32\)\)/);
    assert.match(source, /amountIn: t_out1/);
    assert.match(source, /let v_usdc = amt\d+;/);
    assert.match(source, /hex`a9059cbb[0-9a-f]*3000000000000000000000000000000000000001`;/);
    assert.match(source, /\.concat\(v_usdc\.toBytesBe\(32\)\)/);
  });
});

describe("action programs — errors are precise and complete", () => {
  const cases: Array<[string, unknown, RegExp]> = [
    [
      "a JSON number amount",
      withAction({ ...SAMPLES.approve, amount: 1000000 }),
      /^actions\[0\]\.amount: expected a base-10 string, got the JSON number 1000000 — JSON numbers lose precision above 2\^53, so amounts are strings: write "1000000"$/,
    ],
    [
      "a bigint amount",
      withAction({ ...SAMPLES.approve, amount: 5n }),
      /^actions\[0\]\.amount: expected a base-10 string, got the bigint 5 — JSON has no bigint: write "5"$/,
    ],
    [
      "a non-canonical amount",
      withAction({ ...SAMPLES.approve, amount: "1e18" }),
      /^actions\[0\]\.amount: expected a base-10 unsigned integer string .* got "1e18"$/,
    ],
    [
      "an amount wider than its field",
      withAction({ ...SAMPLES.uniswapV4ExactInput, amountOutMin: (1n << 128n).toString() }),
      /^actions\[0\]\.amountOutMin: 340282366920938463463374607431768211456 does not fit in 128 bits$/,
    ],
    [
      "a bad checksum",
      withAction({ ...SAMPLES.approve, token: "0xa0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" }),
      /^actions\[0\]\.token: 0xa0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48 has an invalid EIP-55 checksum \(expected 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48\)/,
    ],
    [
      "a misspelled field",
      withAction({ ...SAMPLES.uniswapV2Swap, amount: undefined, amuont: "5" }),
      /^actions\[0\]\.amuont: unknown field — did you mean `amount`\?/,
    ],
    [
      "a remote recipient of the wrong width",
      withAction({ ...SAMPLES.cctpBridge, recipient: `0x${"ab".repeat(31)}` }),
      /^actions\[0\]\.recipient: expected an address \(0x \+ 40 hex digits\) or a 32-byte account/,
    ],
    [
      "a misspelled type",
      withAction({ ...SAMPLES.approve, type: "aprove" }),
      /^actions\[0\]\.type: unknown action type "aprove" — did you mean "approve"\?$/,
    ],
    [
      "a missing field",
      withAction({ ...SAMPLES.approve, spender: undefined }),
      /^actions\[0\]\.spender: missing \(the spender\)$/,
    ],
    [
      "a dangling amountRef",
      withAction({ ...SAMPLES.approve, amount: undefined, amountRef: "nope" }),
      /^actions\[0\]\.amountRef: 'nope' is not saved by an earlier action/,
    ],
    [
      "an amountRef beside an explicit amount",
      withAction({ ...SAMPLES.wrapETH, saveOutputAs: "x" }, [
        { ...SAMPLES.approve, amountRef: "x" },
      ]),
      /^actions\[1\]\.amountRef: both `amount` and `amountRef` are set/,
    ],
    [
      "an action carrying a chain",
      withAction({ ...SAMPLES.approve, chainId: 8453 }),
      /^actions\[0\]\.chainId: unknown field/,
    ],
    [
      "a first action with no amount",
      withAction({ ...SAMPLES.approve, amount: undefined }),
      /^actions\[0\]: has no amount: set `amount` or `amountRef`, or put an action before it/,
    ],
    [
      "an amountRef on a source action",
      withAction({ ...SAMPLES.balanceOf, amountRef: "x" }, [
        { ...SAMPLES.approve, amount: undefined },
      ]),
      /^actions\[0\]\.amountRef: balanceOf spends nothing, so it takes no `amountRef`$/,
    ],
    [
      "an amount on an action whose amounts are its own fields",
      withAction({ ...SAMPLES.carbonSwap, amount: "5" }),
      /^actions\[0\]\.amount: carbonSwap takes its amounts from its own fields, so it takes no `amount`$/,
    ],
    [
      "a source action nothing reads",
      withAction(SAMPLES.balanceOf, [SAMPLES.approve]),
      /^actions\[0\]: the value this balanceOf produces is never read/,
    ],
    [
      "a duplicate argument",
      withAction(SAMPLES.argument, [
        { ...SAMPLES.argument },
        { ...SAMPLES.approve, amount: undefined },
      ]),
      /^actions\[1\]\.name: argument 'amount' is already declared by actions\[0\]$/,
    ],
    [
      "a batch step indexing past its assets",
      withAction({
        ...SAMPLES.balancerV2BatchSwap,
        steps: [{ poolId: `0x${"ab".repeat(32)}`, assetInIndex: 0, assetOutIndex: 5, amount: "1" }],
      }),
      /^actions\[0\]\.steps\[0\]\.assetOutIndex: 5 is not an index into `assets` \(2 entries\)$/,
    ],
    [
      "an unsupported version",
      { ...withAction(SAMPLES.approve), version: 2 },
      /^version: unsupported version number 2/,
    ],
    ["no actions", { version: 1, chainId: 1, actions: [] }, /^actions: is empty/],
    ["invalid JSON text", "{ not json", /^\$: not valid JSON/],
  ];

  for (const [name, input, pattern] of cases) {
    it(`reports ${name}`, () => {
      const found = issues(input);
      assert.ok(
        found.some((line) => pattern.test(line)),
        `no issue matched ${pattern}:\n  ${found.join("\n  ")}`,
      );
    });
  }

  it("reports every problem at once, as one ProgramError", () => {
    const bad = {
      version: 1,
      chainId: 1,
      actions: [
        { ...SAMPLES.approve, amount: 1 },
        { ...SAMPLES.transfer, recipient: "nobody" },
        { type: "swap" },
      ],
    };
    assert.equal(issues(bad).length, 3);
    assert.throws(
      () => parseProgram(bad),
      (error: unknown) =>
        error instanceof ProgramError &&
        error.issues.length === 3 &&
        /invalid action program \(3 issues\)/.test(error.message),
    );
  });
});

describe("action programs — the published JSON Schema", () => {
  const schema = programSchema();
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  const validate = ajv.compile(schema);

  it("the committed action-program.schema.json is what the spec generates", () => {
    const committed = JSON.parse(
      readFileSync(resolve(REPO_ROOT, "actions/action-program.schema.json"), "utf8"),
    );
    assert.deepEqual(
      committed,
      JSON.parse(JSON.stringify(schema)),
      "stale schema — run `pnpm --filter './actions' gen-schema`",
    );
  });

  it("accepts every valid program the parser accepts", () => {
    for (const type of ACTION_TYPES) {
      const program = sampleProgram(type);
      assert.ok(validate(program), `${type}: ${ajv.errorsText(validate.errors)}`);
      // And the parser's canonical output is itself valid under the schema.
      assert.ok(validate(JSON.parse(serializeProgram(program))));
    }
  });

  it("rejects what the parser rejects structurally", () => {
    const structural: unknown[] = [
      withAction({ ...SAMPLES.approve, amount: 1000000 }),
      withAction({ ...SAMPLES.approve, amount: "1e18" }),
      withAction({ ...SAMPLES.uniswapV2Swap, amuont: "5" }),
      withAction({ ...SAMPLES.approve, type: "aprove" }),
      withAction({ ...SAMPLES.transfer, recipient: "nobody" }),
      withAction({ ...SAMPLES.approve, chainId: 1 }),
      withAction({ ...SAMPLES.cctpBridge, recipient: "self" }),
      withAction({ ...SAMPLES.carbonSwap, amount: "5" }),
      withAction({ ...SAMPLES.balanceOf, amountRef: "x" }),
      withAction({ ...SAMPLES.curveRouterNGSwap, swapParams: [[1, 2, 3]] }),
      withAction({ ...SAMPLES.dodoSwap, version: "v3" }),
      { version: 2, chainId: 1, actions: [SAMPLES.approve] },
      { version: 1, chainId: 1, actions: [] },
      { version: 1, chainId: 1, actions: [SAMPLES.approve], extra: true },
    ];
    for (const input of structural) {
      assert.ok(rejects(input));
      assert.equal(validate(input), false, `schema accepted ${JSON.stringify(input)}`);
    }
  });

  it("leaves checksums and chaining to the parser, as its description says", () => {
    const semanticOnly: unknown[] = [
      withAction({ ...SAMPLES.approve, token: "0xa0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" }),
      withAction({ ...SAMPLES.approve, amount: undefined, amountRef: "nope" }),
      withAction({ ...SAMPLES.approve, amount: undefined }),
    ].map((p) => JSON.parse(JSON.stringify(p)));
    for (const input of semanticOnly) {
      assert.ok(validate(input), "the schema cannot express this rule");
      assert.ok(rejects(input));
    }
  });
});
