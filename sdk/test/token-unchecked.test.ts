/**
 * `token/unchecked.ts` — the USDT-safe ERC-20 lowering, and the regression lock that keeps the two
 * nesting emitters on it.
 *
 * The hazard is not visible in any assertion about a standard token: compiler 2.3.0 lowers a
 * declared `bool` output to call-then-DECODE even when nothing reads it, and decoding from empty
 * returndata reverts on this engine. So the property under test is the ABSENCE of a declared output,
 * and the thing that must not come back is `IERC20.at(t).approve(...)`/`.transfer(...)`.
 * `routes-nest-dynamic.e2e.test.ts` is where a real no-return token executes; this suite is what
 * still runs with no engine.
 */
import { encodeFunctionData, type Hex } from "viem";

import { compileProgram as compile } from "./helpers";
import { ERC20ABI } from "../src/protocols/erc20/abis.js";
import { uncheckedApproveStatements, uncheckedTransferStatements } from "../src/token/unchecked.js";
import { nestedTransferStatements } from "../src/routes/nest.js";
import { dynamicChildStatements } from "../src/routes/nest-dynamic.js";
import { AMOUNT_IN_PLACEHOLDER, AMOUNT_OUT_PLACEHOLDER } from "../src/routes/nest-dynamic.js";
import { normalizeReward, normalizeRoute } from "../src/routes/normalize.js";
import { requireChain } from "../src/chains/canonical.js";
import type { Intent } from "../src/routes/types.js";

const TOKEN = 0x7777777777777777777777777777777777777777n;
const SPENDER = 0x2222222222222222222222222222222222222222n;
const RECIPIENT = 0x9999999999999999999999999999999999999999n;

const addr = (value: bigint): Hex => `0x${value.toString(16).padStart(40, "0")}`;

/** The one `evm.call` a statement list ends with, split into its target and its data expression. */
function callOf(statements: readonly string[]): { target: string; data: string } {
  const call = statements.at(-1)!;
  const match = /^evm\.call\(([^,]+), 0n, (.+)\);$/.exec(call);
  if (match === null) throw new Error(`not an evm.call: ${call}`);

  return { target: match[1]!, data: match[2]! };
}

/** Rebuilds off-chain what the emitted concat chain assembles at run time, so it can be compared
 *  against viem's own encoding of the same call. */
function render(statements: readonly string[], locals: Readonly<Record<string, bigint>>): Hex {
  const consts = new Map<string, string>();
  for (const statement of statements) {
    const declared = /^const (\w+) = hex`([0-9a-f]*)`;$/.exec(statement);
    if (declared !== null) consts.set(declared[1]!, declared[2]!);
  }
  let out = "";
  for (const term of callOf(statements).data.split(".concat(")) {
    const cleaned = term.replace(/\)+$/, "");
    const word = /^(\w+)\.toBytesBe\(32$/.exec(cleaned);
    if (word !== null) {
      out += locals[word[1]!]!.toString(16).padStart(64, "0");
      continue;
    }
    out += consts.get(cleaned) ?? "";
  }

  return `0x${out}`;
}

describe("the emitted calldata is viem's, byte for byte", () => {
  it("approve with a literal spender and a run-time amount", () => {
    const statements = uncheckedApproveStatements(
      "d0_",
      `${TOKEN}n`,
      { literal: SPENDER },
      {
        local: "amt",
      },
    );

    expect(render(statements, { amt: 12345n })).toBe(
      encodeFunctionData({
        abi: ERC20ABI,
        functionName: "approve",
        args: [addr(SPENDER), 12345n],
      }).toLowerCase(),
    );
    expect(callOf(statements).target).toBe(`${TOKEN}n`);
  });

  it("transfer with BOTH arguments run-time — the empty run between them is not emitted", () => {
    const statements = uncheckedTransferStatements(
      "n0_",
      `${TOKEN}n`,
      { local: "to" },
      {
        local: "amt",
      },
    );

    expect(render(statements, { to: RECIPIENT, amt: 7n })).toBe(
      encodeFunctionData({
        abi: ERC20ABI,
        functionName: "transfer",
        args: [addr(RECIPIENT), 7n],
      }).toLowerCase(),
    );
    // One const, not two: nothing sits between the two spliced words.
    expect(statements.filter((s) => s.startsWith("const "))).toHaveLength(1);
  });

  it("a fully static call is one literal with nothing concatenated", () => {
    const statements = uncheckedTransferStatements(
      "n1_",
      `${TOKEN}n`,
      { literal: RECIPIENT },
      {
        literal: 7n,
      },
    );

    expect(statements).toHaveLength(2);
    expect(render(statements, {})).toBe(
      encodeFunctionData({
        abi: ERC20ABI,
        functionName: "transfer",
        args: [addr(RECIPIENT), 7n],
      }).toLowerCase(),
    );
  });

  it("rejects an argument count the ABI does not declare", () => {
    expect(() =>
      uncheckedApproveStatements("d0_", `${TOKEN}n`, { literal: SPENDER }, { local: "a" }),
    ).not.toThrow();
    // The guard exists for a moved ABI; the reachable half of it is the arity check.
    expect(() =>
      // @ts-expect-error deliberately calling the private arity path through a wrong shape
      uncheckedApproveStatements("d0_", `${TOKEN}n`, { literal: SPENDER }),
    ).toThrow();
  });

  it("compiles, and declares no unused local", () => {
    const body = [
      "const amt = 5n;",
      "const to = 9n;",
      ...uncheckedApproveStatements("d0_", `${TOKEN}n`, { literal: SPENDER }, { local: "amt" }),
      ...uncheckedTransferStatements("n0_", `${TOKEN}n`, { local: "to" }, { local: "amt" }),
      ...uncheckedTransferStatements("n1_", `${TOKEN}n`, { literal: RECIPIENT }, { literal: 7n }),
    ].join("\n");

    expect(() => compile(`function main() {\n${body}\n}`)).not.toThrow();
  });
});

describe("neither nesting emitter can go back to a bool-returning binding", () => {
  const BASE = requireChain("base");
  const ARBITRUM = requireChain("arbitrum");
  const PORTAL = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as const;

  const child = (amount: bigint): Intent => ({
    destination: BigInt(ARBITRUM.id),
    sourceChainId: BigInt(BASE.id),
    route: normalizeRoute({
      salt: `0x${"01".repeat(32)}` as Hex,
      deadline: 2000n,
      portal: PORTAL,
      tokens: [{ token: addr(RECIPIENT), amount: AMOUNT_OUT_PLACEHOLDER }],
      calls: [],
    }),
    reward: normalizeReward({
      deadline: 2000n,
      creator: addr(SPENDER),
      prover: addr(RECIPIENT),
      tokens: [{ token: addr(TOKEN), amount }],
    }),
  });

  it("the DYNAMIC approve is an evm.call, and balanceOf keeps its binding", () => {
    const statements = dynamicChildStatements(child(AMOUNT_IN_PLACEHOLDER), 0, {
      portal: PORTAL,
      measure: { kind: "erc20Balance", token: addr(TOKEN) },
      placeholders: [
        { value: AMOUNT_IN_PLACEHOLDER, source: "amountIn", occurrences: 1 },
        { value: AMOUNT_OUT_PLACEHOLDER, source: "amountOut", occurrences: 1 },
      ],
    });

    expect(statements.some((s) => s.includes(".approve("))).toBe(false);
    expect(statements.filter((s) => s.startsWith("evm.call("))).toHaveLength(2); // approve + publish
    // A `uint256` return is always present, so the read keeps the typed binding.
    expect(statements[0]).toContain("IERC20.at(");
    expect(statements[0]).toContain(".balanceOf(ctx.self())");
  });

  it("the TRANSFER-mode transfer is an evm.call inside the zero guard", () => {
    const statements = nestedTransferStatements(child(500n), 0, {
      vaultResolution: { mode: "explicit", vault: addr(RECIPIENT) },
    });

    expect(statements.some((s) => s.includes(".transfer("))).toBe(false);
    expect(statements.some((s) => /^if \(\w+ > 0n\) \{ evm\.call\(/.test(s))).toBe(true);
    expect(statements.some((s) => s.includes(".balanceOf(ctx.self())"))).toBe(true);
  });
});
