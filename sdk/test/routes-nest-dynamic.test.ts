/**
 * routes/nest-dynamic.ts — a child intent CREATED ON-CHAIN from a runtime-measured amount.
 *
 * WHAT IS ACTUALLY PROVEN HERE, and what is not. There is no engine in this environment
 * (`SAUCE_RUST_ENGINE_SO`/`SAUCE_V12_RUNTIME_CREATION_HEX` are unset), so nothing below EXECUTES.
 * Three real signals stand in for it:
 *
 *  1. BYTE IDENTITY. `renderDynamicChild` produces, for a given measurement, exactly the calldata
 *     `portal.ts#publishAndFundTx` produces for the CONCRETE child with those amounts. Both sides
 *     go through the same encoder, so this checks the SPLICE — that cutting a payload at its
 *     sentinels and reassembling it around real numbers reproduces the payload — which is the one
 *     thing the design rests on.
 *  2. HASH IDENTITY. Decoding the rendered calldata and re-deriving the intent hash from its route
 *     bytes and reward tuple yields `hashIntent`'s hash for the concrete child. A Portal receiving
 *     these bytes commits to the intent the caller meant.
 *  3. COMPILATION. The emitted program compiles through the real pinned compiler, and every rendered
 *     segment appears VERBATIM in the emitted bytecode — so the literal runs the program will
 *     concatenate are the bytes this module cut, not a truncated or re-encoded copy.
 *
 * What none of this establishes: that `.concat`/`.toBytesBe` behave at runtime as their names say,
 * that the engine's `evm.call` reaches the Portal with the assembled payload, or that the Portal
 * accepts it. A design that compiles is not a design that lands on-chain. Those four now have their
 * own suite — `routes-nest-dynamic.e2e.test.ts` runs this exact program on a real engine, a real
 * Pot and the real eco-routes Portal, and reads the child's route bytes back out of
 * `IntentPublished`. It is engine-gated; this suite is what still runs without one.
 */
import {
  decodeFunctionData,
  encodeFunctionData,
  encodePacked,
  erc20Abi,
  keccak256,
  type Hex,
} from "viem";

import { compileProgram as compile, SDK_SOURCE_DIRS } from "./helpers";
import { requireChain } from "../src/chains/canonical.js";
import { hashIntent, rewardHash } from "../src/routes/encode.js";
import {
  AMOUNT_IN_PLACEHOLDER,
  AMOUNT_IN_PLACEHOLDER_U64,
  AMOUNT_OUT_PLACEHOLDER,
  AMOUNT_OUT_PLACEHOLDER_U64,
  dynamicChildProgram,
  dynamicChildStatements,
  dynamicChildTemplate,
  renderDynamicChild,
  WAD,
  type DynamicChildOptions,
} from "../src/routes/nest-dynamic.js";
import { assertNestingInvariants } from "../src/routes/nest.js";
import { normalizeReward, normalizeRoute, toUniversalAddress } from "../src/routes/normalize.js";
import { PortalABI } from "../src/protocols/eco-routes/abis.js";
import { publishAndFundTx } from "../src/routes/portal.js";
import { renderTemplate, scaleAmount } from "../src/routes/template.js";
import type { Intent } from "../src/routes/types.js";

const BASE = requireChain("base");
const ARBITRUM = requireChain("arbitrum");
const SOLANA = requireChain("solana");

const PARENT_PORTAL = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as const;
const CHILD_ROUTE_PORTAL = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as const;
const CREATOR = "0x3333333333333333333333333333333333333333" as const;
const PROVER = "0x4444444444444444444444444444444444444444" as const;
const USDC = "0x7777777777777777777777777777777777777777" as const;
const RECIPIENT = "0x9999999999999999999999999999999999999999" as const;
const SALT = `0x${"01".repeat(32)}` as Hex;

/** One EVM->EVM child: the solver must deliver `out` on Arbitrum, escrowed with `inn` on Base. */
function evmChild(inn: bigint, out: bigint): Intent {
  return {
    destination: BigInt(ARBITRUM.id),
    sourceChainId: BigInt(BASE.id), // the parent's destination chain, by construction
    route: normalizeRoute({
      salt: SALT,
      deadline: 2000n,
      portal: CHILD_ROUTE_PORTAL,
      tokens: [{ token: USDC, amount: out }],
      calls: [
        {
          target: USDC,
          data: encodeFunctionData({
            abi: erc20Abi,
            functionName: "transfer",
            args: [RECIPIENT, out],
          }),
        },
      ],
    }),
    reward: normalizeReward({
      deadline: 2000n,
      creator: CREATOR,
      prover: PROVER,
      tokens: [{ token: USDC, amount: inn }],
    }),
  };
}

const SCALE = 990000000000000000n; // 0.99 WAD — a 1% spread, the shape a real cascade uses

const OPTS: DynamicChildOptions = {
  portal: PARENT_PORTAL,
  measure: { kind: "erc20Balance", token: USDC },
  scale: SCALE,
  placeholders: [
    { value: AMOUNT_IN_PLACEHOLDER, source: "amountIn", occurrences: 1 },
    { value: AMOUNT_OUT_PLACEHOLDER, source: "amountOut", occurrences: 2 },
  ],
};

const templated = evmChild(AMOUNT_IN_PLACEHOLDER, AMOUNT_OUT_PLACEHOLDER);

/** The intent hash a Portal would derive from calldata, re-deriving it from the wire bytes rather
 *  than from the `Intent` object — `keccak256(abi.encodePacked(uint64 destination, bytes32
 *  routeHash, bytes32 rewardHash))`, per `IntentSource.getIntentHash`. */
function intentHashOfCalldata(calldata: Hex): Hex {
  const { functionName, args } = decodeFunctionData({ abi: PortalABI, data: calldata });
  expect(functionName).toBe("publishAndFund");
  const [destination, routeBytes, reward] = args as [
    bigint,
    Hex,
    {
      deadline: bigint;
      creator: Hex;
      prover: Hex;
      nativeAmount: bigint;
      tokens: readonly { token: Hex; amount: bigint }[];
    },
    boolean,
  ];
  const wHash = rewardHash(
    {
      deadline: reward.deadline,
      creator: toUniversalAddress(reward.creator),
      prover: toUniversalAddress(reward.prover),
      nativeAmount: reward.nativeAmount,
      tokens: reward.tokens.map((t) => ({ token: toUniversalAddress(t.token), amount: t.amount })),
    },
    Number(BASE.id),
  );
  return keccak256(
    encodePacked(["uint64", "bytes32", "bytes32"], [destination, keccak256(routeBytes), wHash]),
  );
}

describe("the rendered calldata IS the concrete child's calldata", () => {
  it.each([1n, 2n, 1_000_000n, 123_456_789n, 10n ** 24n])(
    "amountIn=%s renders byte-for-byte what publishAndFundTx builds for the concrete child",
    (amountIn) => {
      const amountOut = scaleAmount(amountIn, SCALE);
      const rendered = renderDynamicChild(templated, OPTS, amountIn);
      const concrete = publishAndFundTx(evmChild(amountIn, amountOut), false, {
        portal: PARENT_PORTAL,
      }).data;

      expect(rendered).toEqual(concrete);
    },
  );

  it("the hash a Portal derives from the rendered bytes is the concrete child's intentHash", () => {
    const amountIn = 5_000_000n;
    const amountOut = scaleAmount(amountIn, SCALE);

    expect(intentHashOfCalldata(renderDynamicChild(templated, OPTS, amountIn))).toEqual(
      hashIntent(evmChild(amountIn, amountOut)).intentHash,
    );
  });

  it("carries allowPartial through to the encoded call", () => {
    const decode = (allowPartial: boolean) =>
      decodeFunctionData({
        abi: PortalABI,
        data: renderDynamicChild(templated, { ...OPTS, allowPartial }, 1n),
      }).args?.[3];

    expect(decode(false)).toBe(false);
    expect(decode(true)).toBe(true);
  });

  it("cuts the child at exactly the declared sentinels — 3 slots, 4 segments", () => {
    const template = dynamicChildTemplate(templated, OPTS);

    expect(template.slots.map((s) => s.source)).toEqual(["amountOut", "amountOut", "amountIn"]);
    expect(template.segments).toHaveLength(4);
    // The selector survives in segment 0: the first sentinel cannot be at offset 0.
    expect(
      template.segments[0]!.startsWith(
        publishAndFundTx(templated, false, { portal: PARENT_PORTAL }).data.slice(0, 10),
      ),
    ).toBe(true);
  });
});

describe("the emitted program", () => {
  const statements = dynamicChildStatements(templated, 0, OPTS);

  it("measures, floor-checks, derives, renders, approves and publishes — in that order", () => {
    const usdc = BigInt(USDC);
    const portal = BigInt(PARENT_PORTAL);

    expect(statements[0]).toBe(`const d0_in = IERC20.at(${usdc}n).balanceOf(ctx.self());`);
    expect(statements[1]).toBe("if (d0_in < 1n) { throw 'sauce: measured amount below floor'; }");
    expect(statements[2]).toMatch(
      /^if \(d0_in > \d+n\) \{ throw 'sauce: measured amount overflows scale'; \}$/,
    );
    expect(statements[3]).toBe(
      "const d0_out = (d0_in * 990000000000000000n + 999999999999999999n) / 1000000000000000000n;",
    );
    // ... segment consts and the concat chain ...
    // The approve now carries `SafeERC20`/`forceApprove` semantics: an allowance read, a conditional
    // reset, the write, and a check on each write. See `token/safe.ts`.
    const approveText = statements.join("\n");
    expect(approveText).toContain("const d0_0self = ctx.self();");
    expect(approveText).toContain("if (d0_0cur > 0) {");
    expect(approveText).toMatch(/const d0_0ap0 = hex`095ea7b3[0-9a-f]+`;/);
    expect(approveText).toContain(
      `const d0_0ar = evm.call(${usdc}n, 0, d0_0ap0.concat(d0_in.toBytesBe(32)));`,
    );
    expect(statements.at(-1)).toBe(`evm.call(${portal}n, 0n, d0_data);`);

    // The approve names the SAME local the reward tuple's spliced word carries -- the allowance and
    // the escrow can never be two different numbers.
    const concat = statements.find((s) => s.startsWith("const d0_data ="))!;
    expect(concat).toContain("d0_in.toBytesBe(32)");
    expect(concat.match(/d0_out\.toBytesBe\(32\)/g)).toHaveLength(2);
  });

  it("compiles, and every rendered segment survives VERBATIM in the bytecode", () => {
    const program = dynamicChildProgram([{ child: templated, opts: OPTS }]);
    const { bytecode } = compile(program.source, { baseDirs: [...SDK_SOURCE_DIRS] });
    const hex = Buffer.from(bytecode[0]!).toString("hex");

    expect(bytecode[0]!.length).toBeGreaterThan(0);
    const { segments } = dynamicChildTemplate(templated, OPTS);
    for (const segment of segments) {
      if (segment === "0x") continue;
      expect(hex).toContain(segment.slice(2));
    }
  });

  it("merges several children into ONE program with no colliding local", () => {
    const second = evmChild(AMOUNT_IN_PLACEHOLDER, AMOUNT_OUT_PLACEHOLDER);
    const program = dynamicChildProgram([
      { child: templated, opts: OPTS },
      {
        child: { ...second, route: { ...second.route, salt: `0x${"02".repeat(32)}` } },
        opts: OPTS,
      },
    ]);

    expect(program.source).toContain("d0_in");
    expect(program.source).toContain("d1_in");
    expect(() => compile(program.source, { baseDirs: [...SDK_SOURCE_DIRS] })).not.toThrow();
  });

  it("an identity scale needs no derived local and no overflow guard", () => {
    const stmts = dynamicChildStatements(templated, 0, { ...OPTS, scale: WAD });

    expect(stmts.some((s) => s.includes("overflows scale"))).toBe(false);
    expect(stmts.some((s) => s.startsWith("const d0_out ="))).toBe(false);
    expect(stmts.find((s) => s.startsWith("const d0_data ="))).toContain("d0_in.toBytesBe(32)");
  });

  it("minAmountIn: 0n drops the floor entirely; a nonzero one is emitted verbatim", () => {
    expect(
      dynamicChildStatements(templated, 0, { ...OPTS, minAmountIn: 0n }).some((s) =>
        s.includes("below floor"),
      ),
    ).toBe(false);
    expect(dynamicChildStatements(templated, 0, { ...OPTS, minAmountIn: 42n })[1]).toBe(
      "if (d0_in < 42n) { throw 'sauce: measured amount below floor'; }",
    );
  });

  it("measures a native balance or a caller expression when asked to", () => {
    expect(
      dynamicChildStatements(templated, 0, { ...OPTS, measure: { kind: "nativeBalance" } })[0],
    ).toBe("const d0_in = ctx.selfBalance();");
    expect(
      dynamicChildStatements(templated, 0, {
        ...OPTS,
        measure: { kind: "expression", expression: "swapOut" },
      })[0],
    ).toBe("const d0_in = swapOut;");
  });

  it("approve: 'none' emits no allowance at all", () => {
    const stmts = dynamicChildStatements(templated, 0, { ...OPTS, approve: "none" });

    expect(stmts.some((s) => s.includes(".approve("))).toBe(false);
    expect(stmts.at(-1)).toContain("evm.call(");
  });
});

describe("fail-closed", () => {
  it("rejects a fully static child — it would measure a balance and use it for nothing", () => {
    expect(() => dynamicChildStatements(evmChild(1n, 2n), 0, OPTS)).toThrow(
      /does not carry all 2 declared placeholder\(s\)/,
    );
    // The byte-level diagnostic stays reachable as the cause, rather than being re-derived.
    try {
      dynamicChildStatements(evmChild(1n, 2n), 0, OPTS);
    } catch (err) {
      expect((err as Error).cause).toBeInstanceOf(Error);
      expect(((err as Error).cause as Error).message).toMatch(/does not occur in the/);
    }
  });

  it("rejects a zero sentinel — zero bytes are what ABI padding is made of", () => {
    expect(() =>
      dynamicChildTemplate(templated, {
        ...OPTS,
        placeholders: [{ value: 0n, source: "amountIn" }],
      }),
    ).toThrow(/zero placeholder value cannot work/);
  });

  it("rejects a zero or negative scale, which would oblige the solver to deliver nothing", () => {
    expect(() => dynamicChildStatements(templated, 0, { ...OPTS, scale: 0n })).toThrow(
      /scale must be positive/,
    );
  });

  it("rejects a templated reward leg sharing its token with another leg", () => {
    const twoLegs: Intent = {
      ...templated,
      reward: normalizeReward({
        deadline: 2000n,
        creator: CREATOR,
        prover: PROVER,
        tokens: [
          { token: USDC, amount: AMOUNT_IN_PLACEHOLDER },
          { token: USDC, amount: 5n },
        ],
      }),
    };
    expect(() =>
      dynamicChildStatements(twoLegs, 0, {
        ...OPTS,
        placeholders: [
          { value: AMOUNT_IN_PLACEHOLDER, source: "amountIn", occurrences: 1 },
          { value: AMOUNT_OUT_PLACEHOLDER, source: "amountOut", occurrences: 2 },
        ],
      }),
    ).toThrow(/no single allowance to approve without runtime max arithmetic/);
  });

  it("approves the LARGEST static leg per token, never their sum (portal.ts#approvalTxs's rule)", () => {
    const staticLegs: Intent = {
      ...templated,
      reward: normalizeReward({
        deadline: 2000n,
        creator: CREATOR,
        prover: PROVER,
        tokens: [
          { token: USDC, amount: 7n },
          { token: USDC, amount: 11n },
        ],
      }),
    };
    const stmts = dynamicChildStatements(staticLegs, 0, {
      ...OPTS,
      placeholders: [{ value: AMOUNT_OUT_PLACEHOLDER, source: "amountOut", occurrences: 2 }],
    });

    // Fully static: one literal, nothing concatenated. The `11n` is the LARGEST leg, encoded into
    // the calldata by viem rather than spelled as a SauceScript argument.
    const approveText = stmts.join("\n");
    expect(approveText).toContain(
      `const d0_0ap0 = hex\`${encodeFunctionData({
        abi: erc20Abi,
        functionName: "approve",
        args: [PARENT_PORTAL, 11n],
      }).slice(2)}\`;`,
    );
    expect(approveText).toContain(`const d0_0ar = evm.call(${BigInt(USDC)}n, 0, d0_0ap0);`);
  });

  it("dynamicChildProgram rejects an empty entry list", () => {
    expect(() => dynamicChildProgram([])).toThrow(/nothing to compile/);
  });
});

describe("assertNestingInvariants under via: 'dynamic'", () => {
  const parentRoute = normalizeRoute({ deadline: 1000n, portal: PARENT_PORTAL });

  it("skips funding coverage — a ~1.5e77 sentinel would otherwise fail every parent", () => {
    expect(() =>
      assertNestingInvariants({
        parentChain: BASE,
        parentRoute,
        children: [{ intent: templated, via: "dynamic" }],
      }),
    ).not.toThrow();
    // The same child under publishAndFund is rejected, which is what makes the skip load-bearing.
    expect(() =>
      assertNestingInvariants({
        parentChain: BASE,
        parentRoute,
        children: [{ intent: templated, via: "publishAndFund" }],
      }),
    ).toThrow(/exceeds the parent's route\.tokens amount/);
  });

  it("still enforces the deadline and source-chain invariants", () => {
    expect(() =>
      assertNestingInvariants({
        parentChain: BASE,
        parentRoute: normalizeRoute({ deadline: 9999n, portal: PARENT_PORTAL }),
        children: [{ intent: templated, via: "dynamic" }],
      }),
    ).toThrow(/is earlier than the parent's route\.deadline/);
  });
});

describe("an SVM-destination child: the Borsh route needs u64 little-endian sentinels", () => {
  const SVM_PORTAL = `0x${"11".repeat(32)}` as Hex;
  const SVM_MINT = `0x${"22".repeat(32)}` as Hex;

  function svmChild(inn: bigint, out: bigint): Intent {
    return {
      destination: BigInt(SOLANA.id),
      sourceChainId: BigInt(BASE.id),
      route: normalizeRoute({
        salt: SALT,
        deadline: 2000n,
        portal: SVM_PORTAL,
        tokens: [{ token: SVM_MINT, amount: out }],
        calls: [],
      }),
      // The REWARD is escrowed on the EVM source chain whatever the destination is, so it keeps the
      // 32-byte ABI sentinel -- the asymmetry is `encode.ts`'s, not this module's.
      reward: normalizeReward({
        deadline: 2000n,
        creator: CREATOR,
        prover: PROVER,
        tokens: [{ token: USDC, amount: inn }],
      }),
    };
  }

  const svmOpts: DynamicChildOptions = {
    portal: PARENT_PORTAL,
    measure: { kind: "erc20Balance", token: USDC },
    placeholders: [
      { value: AMOUNT_IN_PLACEHOLDER, source: "amountIn", occurrences: 1 },
      {
        value: AMOUNT_OUT_PLACEHOLDER_U64,
        source: "amountOut",
        width: 8,
        littleEndian: true,
        occurrences: 1,
      },
    ],
  };

  it("renders byte-for-byte what publishAndFundTx builds for the concrete SVM child", () => {
    const amountIn = 4_200_000n;
    const rendered = renderDynamicChild(
      svmChild(AMOUNT_IN_PLACEHOLDER, AMOUNT_OUT_PLACEHOLDER_U64),
      svmOpts,
      amountIn,
    );

    expect(rendered).toEqual(
      publishAndFundTx(svmChild(amountIn, amountIn), false, { portal: PARENT_PORTAL }).data,
    );
  });

  it("emits a little-endian 8-byte splice for the Borsh field and compiles", () => {
    const child = svmChild(AMOUNT_IN_PLACEHOLDER, AMOUNT_OUT_PLACEHOLDER_U64);
    const stmts = dynamicChildStatements(child, 0, svmOpts);

    expect(stmts.find((s) => s.startsWith("const d0_data ="))).toContain("d0_in.toBytesLe(8)");
    // IntentTemplate's AmountDoesNotFit guard, emitted because the field is narrower than a word.
    expect(stmts.some((s) => s.includes("does not fit"))).toBe(true);

    const program = dynamicChildProgram([{ child, opts: svmOpts }]);
    expect(() => compile(program.source, { baseDirs: [...SDK_SOURCE_DIRS] })).not.toThrow();
  });

  it("the 32-byte sentinel is rejected outright in a Borsh u64 field, pointing at the u64 twin", () => {
    expect(() =>
      dynamicChildTemplate(svmChild(AMOUNT_IN_PLACEHOLDER, AMOUNT_OUT_PLACEHOLDER), svmOpts),
    ).toThrow(/does not fit in a u64/);
    expect(AMOUNT_IN_PLACEHOLDER_U64).toBeLessThan(2n ** 64n);
    expect(AMOUNT_OUT_PLACEHOLDER_U64).toBeLessThan(2n ** 64n);
  });
});

describe("renderTemplate and the emitted program describe the same splice", () => {
  it("the template's slots and the concat chain agree on order, width and endianness", () => {
    const template = dynamicChildTemplate(templated, OPTS);
    const concat = dynamicChildStatements(templated, 0, OPTS).find((s) =>
      s.startsWith("const d0_data ="),
    )!;
    const emitted = [...concat.matchAll(/\.concat\((d0_\w+)\.(toBytesBe|toBytesLe)\((\d+)\)\)/g)];

    expect(emitted).toHaveLength(template.slots.length);
    template.slots.forEach((slot, i) => {
      expect(emitted[i]![1]).toBe(slot.source === "amountIn" ? "d0_in" : "d0_out");
      expect(emitted[i]![2]).toBe(slot.littleEndian ? "toBytesLe" : "toBytesBe");
      expect(Number(emitted[i]![3])).toBe(slot.width);
    });
    // And the off-chain twin of that chain reproduces the payload it was cut from.
    expect(renderTemplate(template, AMOUNT_IN_PLACEHOLDER, AMOUNT_OUT_PLACEHOLDER)).toEqual(
      publishAndFundTx(templated, false, { portal: PARENT_PORTAL }).data,
    );
  });
});
