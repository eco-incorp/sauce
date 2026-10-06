/**
 * `token/safe.ts` — OpenZeppelin `SafeERC20` semantics in SauceScript, and the regression lock that
 * keeps every emitter on them.
 *
 * Two properties, and neither is visible in an assertion about a well-behaved token. The write must
 * carry no DECLARED OUTPUT, because the compiler decodes one even when nothing reads it and a
 * no-return token sends none. And the result must then be CHECKED, because skipping the decode
 * accepts a `false` return and a call to an address with no code. `routes-intent-bodies.e2e.test.ts`
 * runs both against real tokens; this suite is what still runs with no engine.
 */
import { encodeFunctionData, type Hex } from "viem";

import { compileProgram as compile } from "./helpers";
import { ERC20ABI } from "../src/protocols/erc20/abis.js";
import { safeApproveStatements, safeTransferStatements } from "../src/token/safe.js";

const TOKEN = 0x7777777777777777777777777777777777777777n;
const SPENDER = 0x2222222222222222222222222222222222222222n;
const RECIPIENT = 0x9999999999999999999999999999999999999999n;

const addr = (value: bigint): Hex => `0x${value.toString(16).padStart(40, "0")}`;

/** The LAST `evm.call` in a statement list, split into its target and its data expression. The
 *  check now follows the call, so this can no longer just take the final line. */
function callOf(statements: readonly string[]): { target: string; data: string } {
  for (const line of [...statements].reverse()) {
    const match = /evm\.call\(([^,]+), 0, (.+)\);$/.exec(line);
    if (match !== null) return { target: match[1]!, data: match[2]! };
  }
  throw new Error(`no evm.call in: ${statements.join(" | ")}`);
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
    const statements = safeApproveStatements(
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
    const statements = safeTransferStatements(
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
    // Two consts: the one byte run, and the call's result which the check reads.
    expect(statements.filter((s) => s.startsWith("const ") && s.includes("hex`"))).toHaveLength(1);
  });

  it("a fully static call is one literal with nothing concatenated", () => {
    const statements = safeTransferStatements(
      "n1_",
      `${TOKEN}n`,
      { literal: RECIPIENT },
      {
        literal: 7n,
      },
    );

    // The literal, the call, and the check.
    expect(statements).toHaveLength(3);
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
      safeApproveStatements("d0_", `${TOKEN}n`, { literal: SPENDER }, { local: "a" }),
    ).not.toThrow();
    // The guard exists for a moved ABI; the reachable half of it is the arity check.
    expect(() =>
      // @ts-expect-error deliberately calling the private arity path through a wrong shape
      safeApproveStatements("d0_", `${TOKEN}n`, { literal: SPENDER }),
    ).toThrow();
  });

  it("compiles, and declares no unused local", () => {
    const body = [
      "const amt = 5n;",
      "const to = 9n;",
      ...safeApproveStatements("d0_", `${TOKEN}n`, { literal: SPENDER }, { local: "amt" }),
      ...safeTransferStatements("n0_", `${TOKEN}n`, { local: "to" }, { local: "amt" }),
      ...safeTransferStatements("n1_", `${TOKEN}n`, { literal: RECIPIENT }, { literal: 7n }),
    ].join("\n");

    expect(() => compile(`function main() {\n${body}\n}`)).not.toThrow();
  });
});

describe("every emitted write carries the SafeERC20 check", () => {
  it("accepts empty returndata only from an address with code, and otherwise demands true", () => {
    const statements = safeTransferStatements("s_", "1n", { local: "to" }, { local: "amt" });
    const check = statements.at(-1)!;

    // A DECODE, not `s_tr.toBe()`: the decode refuses a return shorter than a word and reads only
    // the first word of a longer one, as OpenZeppelin does. `toBe()` zero-pads a 1-byte `0x01` into
    // a 1 and accepts it. `test/std/token/evm.e2e.test.ts` runs both cases beside OpenZeppelin.
    expect(check).toBe(
      "if (s_tr.length == 0) { require(ctx.codeSize(1n) > 0); } " +
        'else { const [s_trok] = abi.decode(s_tr, ["Uint256"]); require(s_trok == 1); }',
    );
  });

  it("approve reads the current allowance and resets it only when non-zero", () => {
    const statements = safeApproveStatements("a_", "1n", { literal: 2n }, { literal: 3n });
    const text = statements.join("\n");

    // `allowance(owner, spender)` returns a uint256, so THIS one is safe to decode normally.
    expect(text).toContain("const a_self = ctx.self();");
    expect(text).toContain("evm.static(1n,");
    // Decoded as a word, like the typed `allowance` read `@sauce/token` makes.
    expect(text).toContain('const [a_cur] = abi.decode(a_qr, ["Uint256"]);');
    expect(text).toContain("if (a_cur > 0) {");
    // Reset, then set: two writes, each with its own check.
    expect(text.match(/require\(ctx\.codeSize/g)).toHaveLength(2);
  });
});
