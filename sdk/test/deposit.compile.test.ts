/**
 * E4.2 universal deposit adapter — real-compile tests. Uses the ordinary
 * compiler, no forge/fork/anvil. Same import + baseDirs pattern as
 * `swap.compile.test.ts`.
 */
import { compileProgram as compile } from "./helpers";

import { DEPOSIT_BASE_DIRS, depositSource } from "../src/deposit/source.js";
import type { DepositKey } from "../src/deposit/templates.js";
import type { DepositSourceSpec } from "../src/deposit/types.js";

const TARGET = "0x1111111111111111111111111111111111111111" as const;
const TOKEN = "0x2222222222222222222222222222222222222222" as const;

function specFor(key: DepositKey): DepositSourceSpec {
  const [protocol, action] = key.split(":") as [string, string];
  switch (key) {
    case "weth:wrap":
    case "lido:stake":
      return { protocol, action, target: TARGET, amount: 1_000n };
    case "weth:unwrap":
      return { protocol, action, target: TARGET, amount: 1_000n };
    default:
      return { protocol, action, target: TARGET, token: TOKEN, amount: 1_000n };
  }
}

const ALL_KEYS: DepositKey[] = [
  "weth:wrap",
  "weth:unwrap",
  "aave-v3:supply",
  "aave-v3:withdraw",
  "spark:supply",
  "spark:withdraw",
  "compound-v3:supply",
  "euler-v2:deposit",
  "erc4626:deposit",
  "lido:stake",
  "lido:wrap",
];

describe("deposit adapter compiles for every registered template", () => {
  for (const key of ALL_KEYS) {
    it(key, () => {
      const { bytecode } = compile(depositSource(specFor(key)), {
        baseDirs: [...DEPOSIT_BASE_DIRS],
      });
      expect(bytecode[0]!.length).toBeGreaterThan(0);
    });
  }
});

describe("amount 'balance' variants compile", () => {
  it("an ERC20 template (aave-v3:supply)", () => {
    const { bytecode } = compile(
      depositSource({ protocol: "aave-v3", action: "supply", target: TARGET, token: TOKEN, amount: "balance" }),
      { baseDirs: [...DEPOSIT_BASE_DIRS] },
    );
    expect(bytecode[0]!.length).toBeGreaterThan(0);
  });

  it("a native-value template (weth:wrap)", () => {
    const { bytecode } = compile(
      depositSource({ protocol: "weth", action: "wrap", target: TARGET, amount: "balance" }),
      { baseDirs: [...DEPOSIT_BASE_DIRS] },
    );
    expect(bytecode[0]!.length).toBeGreaterThan(0);
  });
});

describe("a multi-deposit program (erc4626 + aave-v3, one main())", () => {
  it("compiles", () => {
    const src = depositSource([
      { protocol: "erc4626", action: "deposit", target: TARGET, token: TOKEN, amount: 500n },
      { protocol: "aave-v3", action: "supply", target: TARGET, token: TOKEN, amount: 500n },
    ]);
    const { bytecode } = compile(src, { baseDirs: [...DEPOSIT_BASE_DIRS] });
    expect(bytecode[0]!.length).toBeGreaterThan(0);
  });
});

/**
 * The templates that BIND a selector const (the two WETH raw-calls and lido:stake) are the only ones
 * that can collide, and only against a second deposit of the SAME kind — which is why the
 * mixed-template suite above never caught it. Compiling is the assertion: a redeclared `const` is a
 * compile error, so a shared name cannot pass here.
 */
describe("two deposits of the SAME kind in one main()", () => {
  const twice = (spec: DepositSourceSpec): DepositSourceSpec[] => [spec, spec];

  it("weth:wrap twice declares two distinct selector consts", () => {
    const src = depositSource(twice({ protocol: "weth", action: "wrap", target: TARGET, amount: 1_000n }));

    expect(src).toContain("const dWrap0 = ");
    expect(src).toContain("const dWrap1 = ");

    const { bytecode } = compile(src, { baseDirs: [...DEPOSIT_BASE_DIRS] });
    expect(bytecode[0]!.length).toBeGreaterThan(0);
  });

  it("weth:unwrap twice compiles", () => {
    const src = depositSource(twice({ protocol: "weth", action: "unwrap", target: TARGET, amount: 1_000n }));
    const { bytecode } = compile(src, { baseDirs: [...DEPOSIT_BASE_DIRS] });
    expect(bytecode[0]!.length).toBeGreaterThan(0);
  });

  it("lido:stake twice compiles", () => {
    const src = depositSource(twice({ protocol: "lido", action: "stake", target: TARGET, amount: 1_000n }));
    const { bytecode } = compile(src, { baseDirs: [...DEPOSIT_BASE_DIRS] });
    expect(bytecode[0]!.length).toBeGreaterThan(0);
  });
});
